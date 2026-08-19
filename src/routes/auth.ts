import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { protect, adminCheck } from '../middlewares/authMiddleware';
import redisClient from '../config/redis';
import { sendEmail } from '../utils/email';
import { logAudit } from '../utils/auditLogger';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const router = Router();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// --- STRICT AUTH RATE LIMITER ---
// 5 requests per minute allowed for Auth endpoints to prevent brute-force
const authLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 5, 
  message: { error: 'Too many attempts, please try again after a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- REGISTER ---
router.post('/register', authLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate Verification Token
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const newUser = await prisma.user.create({
      data: {
        name: name,
        email: email,
        password: hashedPassword,
        verifyToken: verifyToken, // Save token in DB
      },
    });

    await prisma.notification.create({
      data: {
        userId: newUser.id,
        type: 'WELCOME',
        message: 'Welcome to the AI Interview Platform! Best of luck for your prep.',
      }
    });

    // Send Verification Email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email?token=${verifyToken}`;

    sendEmail(
      email, 
      'Verify Your Email - AI Interview Platform', 
      `<h3>Hi ${name},</h3>
       <p>Welcome aboard! Please verify your email address by clicking the link below:</p>
       <a href="${verifyUrl}" target="_blank">Verify Email</a>
       <p>If you did not create this account, please ignore this email.</p>`
    );

    return res.status(201).json({
      message: 'User registered successfully. Please check your email to verify your account.',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role, 
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- LOGIN ---
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    if (user.banned) {
      return res.status(403).json({ error: 'Your account has been banned. Please contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' } 
    );

    const refreshToken = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.REFRESH_TOKEN_SECRET as string,
      { expiresIn: '7d' }
    );

    await logAudit('USER_LOGIN', user.id, 'auth', req.ip);

    return res.status(200).json({
      message: 'Login successful',
      accessToken: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role, 
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- FORGOT PASSWORD ---
router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await prisma.user.findUnique({ where: { email } });

    // Security check: Don't leak whether the email exists or not
    if (!user) {
      return res.status(200).json({ message: 'If an account with that email exists, a reset link has been sent.' });
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins expiry

    // Save token to DB
    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExpiry },
    });

    // Send Email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    
    await sendEmail(
      user.email,
      'Password Reset Request - AI Interview Platform',
      `<h3>Hi ${user.name},</h3>
       <p>You requested a password reset. Click the link below to set a new password:</p>
       <a href="${resetUrl}" target="_blank">Reset Password</a>
       <p>This link is valid for 15 minutes. If you didn't request this, please ignore this email.</p>`
    );

    await logAudit('PASSWORD_RESET_REQUESTED', user.id, 'auth', req.ip);

    return res.status(200).json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- RESET PASSWORD ---
router.post('/reset-password', authLimiter, async (req: Request, res: Response): Promise<any> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Invalid input. Password must be at least 6 characters.' });
    }

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() }, // Token should not be expired
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and clear tokens
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    await logAudit('PASSWORD_RESET_SUCCESS', user.id, 'auth', req.ip);

    return res.status(200).json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- GET ME ---
router.get('/me', protect, async (req: any, res: Response): Promise<any> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, email: true, role: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// --- REFRESH TOKEN ---
router.post('/refresh', async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token is required' });
    }

    const isBlacklisted = await redisClient.get(`blacklist_${refreshToken}`);
    if (isBlacklisted) {
      return res.status(403).json({ error: 'Refresh token has been revoked. Please login again.' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET as string);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    const newAccessToken = jwt.sign(
      { userId: decoded.userId, role: decoded.role },
      process.env.JWT_SECRET as string,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      { userId: decoded.userId, role: decoded.role },
      process.env.REFRESH_TOKEN_SECRET as string,
      { expiresIn: '7d' } 
    );

    await redisClient.setEx(`blacklist_${refreshToken}`, 604800, 'true');
    await logAudit('TOKEN_REFRESH', decoded.userId, 'auth', req.ip);

    return res.status(200).json({
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- LOGOUT ---
router.post('/logout', async (req: Request, res: Response): Promise<any> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET as string);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    if (expiresIn > 0) {
      await redisClient.setEx(`blacklist_${refreshToken}`, expiresIn, 'blacklisted');
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- ADMIN CHECK ---
router.get('/admin-only', protect, adminCheck, (req: Request, res: Response) => {
  res.status(200).json({ message: 'Admin access granted.' });
});

// --- VERIFY EMAIL ---
router.get('/verify-email', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing verification token.' });
    }

    const user = await prisma.user.findFirst({
      where: { verifyToken: token },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid token. Your email might already be verified.' });
    }

    // Update user to verified and clear the token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verifyToken: null,
      },
    });

    await logAudit('EMAIL_VERIFIED', user.id, 'auth', req.ip);
    sendEmail(
      user.email, 
      'Welcome to AI Interview Platform!', 
      `<h3>Hi ${user.name},</h3>
       <p>Your email has been successfully verified! Welcome aboard.</p>
       <p>You can now log in and start your first AI mock interview today. Best of luck for your prep!</p>`
    );

    return res.status(200).json({ message: 'Email verified successfully! You can now log in.' });
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;