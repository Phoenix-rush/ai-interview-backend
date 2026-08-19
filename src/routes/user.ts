import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

// PUT /api/v1/user/profile
router.put('/profile', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user.userId;
    const { name, currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const updateData: { name?: string; password?: string } = {};

    if (name && name.trim()) {
      updateData.name = name.trim();
    }

    // Only touch the password if the user actually filled in newPassword
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set a new password.' });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      }

      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(newPassword, salt);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return res.status(200).json({
      message: 'Profile updated successfully.',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });

  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;