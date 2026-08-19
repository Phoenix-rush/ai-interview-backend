import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

router.post('/', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { interviewId, questionId, transcript, duration, skipped } = req.body;

    if (!interviewId || !questionId) {
      return res.status(400).json({ error: 'interviewId and questionId are required.' });
    }

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found.' });
    }
    if (interview.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden. You do not own this interview.' });
    }

    // Save the answer
    const answer = await prisma.interviewAnswer.create({
      data: {
        interviewId,
        questionId,
        transcript: transcript || '',
        duration: duration || 0,
        skipped: skipped || false,
      },
    });

    return res.status(201).json({ message: 'Answer saved successfully', answer });
  } catch (error) {
    console.error('Save answer error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/:interviewId', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const interviewId = req.params.interviewId as string;

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview) {
      return res.status(404).json({ error: 'Interview not found.' });
    }
    if (interview.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const answers = await prisma.interviewAnswer.findMany({
      where: { interviewId },
      orderBy: { createdAt: 'asc' },
    });

    return res.status(200).json({ answers });
  } catch (error) {
    console.error('Fetch answers error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;