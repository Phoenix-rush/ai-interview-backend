import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, adminCheck, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

router.get('/stats', protect, adminCheck, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const totalUsers = await prisma.user.count();
    const totalInterviews = await prisma.interview.count();
    const completedInterviews = await prisma.interview.count({ where: { status: 'COMPLETED' } });
    const totalFeedback = await prisma.interviewFeedback.count();

    return res.status(200).json({
      totalUsers,
      totalInterviews,
      completedInterviews,
      totalFeedback
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/users', protect, adminCheck, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        banned: true,
        createdAt: true,
        stats: {
          select: { totalInterviews: true, avgScore: true }
        }
      }
    });

    return res.status(200).json({ users });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/interviews', protect, adminCheck, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const interviews = await prisma.interview.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { name: true, email: true } },
        feedback: { select: { grade: true } }
      }
    });

    return res.status(200).json({ interviews });
  } catch (error) {
    console.error('Admin interviews error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/users/:id/ban', protect, adminCheck, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.params.id as string;
    const { banned } = req.body;

    if (typeof banned !== 'boolean') {
      return res.status(400).json({ error: 'Please provide a valid boolean value for banned.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { banned }
    });

    return res.status(200).json({
      message: `User successfully ${banned ? 'banned' : 'unbanned'}`,
      user: { id: updatedUser.id, email: updatedUser.email, banned: updatedUser.banned }
    });
  } catch (error) {
    console.error('Ban user error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;