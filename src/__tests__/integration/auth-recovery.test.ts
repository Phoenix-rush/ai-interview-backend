import request from 'supertest';
import app from '../../index';
import prisma from '../../config/prisma';
import redisClient from '../../config/redis';
import bcrypt from 'bcrypt';

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    isOpen: false,
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  },
}));

jest.mock('../../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

// This file makes more than 5 requests to auth endpoints, which share a single
// 5-req/min rate limiter instance — bypass it here so tests don't get 429'd.
jest.mock('express-rate-limit', () => {
  return jest.fn(() => (req: any, res: any, next: any) => next());
});

describe('Auth Recovery Flows Integration Tests', () => {
  let userId: string;
  const userEmail = 'recoveryuser@example.com';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: userEmail } });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('OriginalPass123', salt);

    const user = await prisma.user.create({
      data: {
        name: 'Recovery User',
        email: userEmail,
        password: hashedPassword,
        role: 'USER',
        verifyToken: 'known-verify-token-123',
      },
    });
    userId = user.id;
  }, 20000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should generate a reset token for an existing user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: userEmail });

      expect(response.status).toBe(200);

      const updated = await prisma.user.findUnique({ where: { id: userId } });
      expect(updated?.resetToken).not.toBeNull();
      expect(updated?.resetTokenExpiry).not.toBeNull();
    });

    it('should return the same generic message for a non-existent email (no leaking)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'doesnotexist@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('If an account with that email exists, a reset link has been sent.');
    });

    it('should return 400 if email is missing', async () => {
      const response = await request(app).post('/api/v1/auth/forgot-password').send({});
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('should return 400 for an invalid or expired token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'invalid-token', newPassword: 'NewPass123' });

      expect(response.status).toBe(400);
    });

    it('should return 400 for a password shorter than 6 characters', async () => {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: user?.resetToken, newPassword: '123' });

      expect(response.status).toBe(400);
    });

    it('should reset the password with a valid token', async () => {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: user?.resetToken, newPassword: 'BrandNewPass456' });

      expect(response.status).toBe(200);

      const updated = await prisma.user.findUnique({ where: { id: userId } });
      expect(updated?.resetToken).toBeNull();
      expect(updated?.resetTokenExpiry).toBeNull();

      const passwordMatches = await bcrypt.compare('BrandNewPass456', updated!.password);
      expect(passwordMatches).toBe(true);
    });

    it('should reject reusing the same (now-cleared) token again', async () => {
      const response = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'already-used-or-cleared-token', newPassword: 'AnotherPass789' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/auth/verify-email', () => {
    it('should return 400 when no token is provided', async () => {
      const response = await request(app).get('/api/v1/auth/verify-email');
      expect(response.status).toBe(400);
    });

    it('should verify the email with a valid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify-email')
        .query({ token: 'known-verify-token-123' });

      expect(response.status).toBe(200);

      const updated = await prisma.user.findUnique({ where: { id: userId } });
      expect(updated?.emailVerified).toBe(true);
      expect(updated?.verifyToken).toBeNull();
    });

    it('should return 400 when the same token is used again', async () => {
      const response = await request(app)
        .get('/api/v1/auth/verify-email')
        .query({ token: 'known-verify-token-123' });

      expect(response.status).toBe(400);
    });
  });
});