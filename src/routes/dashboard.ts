import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

router.get('/:userId', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.params.userId as string;

    if (req.user.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden. You can only view your own dashboard.' });
    }

    let stats = await prisma.userStats.findUnique({ where: { userId } });
    if (!stats) {
      stats = {
        id: '',
        userId,
        totalInterviews: 0,
        avgScore: 0,
        currentStreak: 0,
        updatedAt: new Date(),
      };
    }

    const recentInterviews = await prisma.interview.findMany({
      where: {
        userId,
        status: 'COMPLETED'
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        feedback: true
      }
    });

    const history = recentInterviews.map(inv => ({
      id: inv.id,
      role: inv.role,
      difficulty: inv.difficulty,
      date: inv.createdAt,
      totalScore: inv.feedback?.scores ? (inv.feedback.scores as any).total : 0,
      grade: inv.feedback?.grade || 'N/A'
    }));

    // --- NEW: category-level averages for the dashboard radar chart ---
    const scoresList = recentInterviews
      .map((inv) => inv.feedback?.scores as any)
      .filter(Boolean);

    const averageOf = (key: string) => {
      const sum = scoresList.reduce((acc: number, s: any) => acc + (s[key] || 0), 0);
      return Math.round((sum / scoresList.length) * 10) / 10;
    };

    const categoryAverages = scoresList.length > 0
      ? [
          { subject: 'Communication', A: averageOf('communication'), fullMark: 20 },
          { subject: 'Technical', A: averageOf('technical'), fullMark: 30 },
          { subject: 'Problem Solving', A: averageOf('problemSolving'), fullMark: 30 },
          { subject: 'Confidence', A: averageOf('confidence'), fullMark: 10 },
          { subject: 'Time Mgmt', A: averageOf('timeManagement'), fullMark: 10 },
        ]
      : [];

    return res.status(200).json({
      stats: {
        totalInterviews: stats.totalInterviews,
        averageScore: stats.avgScore.toFixed(1),
        currentStreak: stats.currentStreak
      },
      recentHistory: history,
      categoryAverages
    });

  } catch (error) {
    console.error('Dashboard fetch error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;