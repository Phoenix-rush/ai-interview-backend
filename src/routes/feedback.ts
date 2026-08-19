import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';
import { feedbackQueue } from '../queues/feedbackQueue';

const router = Router();

router.post('/generate', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { interviewId } = req.body;

    if (!interviewId) return res.status(400).json({ error: 'interviewId is required.' });

    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });
    if (!interview || interview.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden or Interview not found.' });
    }

    const existingFeedback = await prisma.interviewFeedback.findUnique({ where: { interviewId } });
    if (existingFeedback) {
      return res.status(400).json({ error: 'Feedback already exists.' });
    }

    await feedbackQueue.add('generate-feedback', {
      interviewId,
      userId: req.user.userId
    });

    return res.status(202).json({ message: 'Feedback generation queued successfully. Please check status in a few seconds.' });

  } catch (error) {
    console.error('Queue feedback error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/status/:interviewId', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const interviewId = req.params.interviewId as string;
    
    const feedback = await prisma.interviewFeedback.findUnique({ where: { interviewId } });
    
    if (feedback) {
      return res.status(200).json({ status: 'READY', feedback });
    } else {
      return res.status(200).json({ status: 'PROCESSING' });
    }
  } catch (error) {
    console.error('Fetch feedback status error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;