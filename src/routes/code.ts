// File: backend/src/routes/code.ts
import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';
import crypto from 'crypto';
import { runCodeInDocker } from '../utils/executeCode'; // Tera apna Engine!

const router = Router();

router.post('/execute', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { interviewId, questionId, code, languageId } = req.body;

    if (!code || !languageId || !interviewId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const token = crypto.randomUUID();
    
    // Yahan tera engine directly Docker container trigger karega (No external APIs!)
    // Input parameters mein hidden test cases daal sakte hain (Abhi ke liye blank string '')
    const result = await runCodeInDocker(languageId.toString(), code, '');

    // Database mein seedha save
    await prisma.codeSubmission.create({
      data: {
        id: token,
        interviewId,
        questionId: questionId || 'default',
        code,
        language: languageId.toString(),
        verdict: result.verdict,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    });

    return res.status(200).json({ message: 'Code executed internally', token });
  } catch (error: any) {
    console.error('Custom Engine Error:', error.message);
    return res.status(500).json({ error: 'Failed to execute code internally.' });
  }
});

router.get('/result/:token', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const token = req.params.token as string;
    
    const submission = await prisma.codeSubmission.findUnique({
      where: { id: token }
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    return res.status(200).json({
      status: submission.verdict,
      stdout: submission.stdout,
      stderr: submission.stderr,
      isCompleted: true
    });
  } catch (error) {
    console.error('Fetch result error:', error);
    return res.status(500).json({ error: 'Failed to fetch result.' });
  }
});

export default router;