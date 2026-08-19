import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';
import { geminiModel } from '../config/gemini';

const router = Router();

// POST /api/v1/interview/create
router.post('/create', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user.userId;
    const { role, difficulty, duration } = req.body;

    if (!role || !difficulty || !duration) {
      return res.status(400).json({ error: 'Role, difficulty, and duration are required.' });
    }

    const resume = await prisma.resume.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!resume || !resume.parsedData) {
      return res.status(404).json({ error: 'No parsed resume found for this user. Please upload a resume first.' });
    }

    const resumeData = JSON.stringify(resume.parsedData);

    const prompt = `
      You are an expert technical interviewer. Create an interview question set for a candidate applying for the role of "${role}" with a difficulty level of "${difficulty}".
      
      Here is the candidate's parsed resume data:
      ${resumeData}
      
      Generate exactly 8 questions tailored to their skills, experience, and the target role. 
      The questions should be a mix of CONCEPTUAL, CODING, BEHAVIORAL, and SYSTEM_DESIGN.
      
      Return ONLY a valid JSON array of objects. Do not include any markdown wrappers (like \`\`\`json).
      Structure required:
      [
        {
          "question": "string",
          "type": "CONCEPTUAL" | "CODING" | "BEHAVIORAL" | "SYSTEM_DESIGN"
        }
      ]
    `;

    // Updated to use the centralized model
    const aiResult = await geminiModel.generateContent(prompt);
    const rawText = aiResult.response.text();
    
    if (!rawText) {
      throw new Error('Gemini did not return any content.');
    }

    const cleanJsonString = rawText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const questionsArray = JSON.parse(cleanJsonString);

    const interview = await prisma.interview.create({
      data: {
        userId,
        role,
        difficulty,
        duration: parseInt(duration),
        status: 'PENDING',
        questions: {
          create: questionsArray.map((q: any, index: number) => ({
            question: q.question,
            type: q.type,
            order: index + 1
          }))
        }
      },
      include: {
        questions: true
      }
    });

    return res.status(201).json({
      message: 'Interview session and questions generated successfully.',
      interview
    });

  } catch (error) {
    console.error('Interview generation error:', error);
    return res.status(500).json({ error: 'Internal server error during interview generation.' });
  }
});

router.get('/:id', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const interview = await prisma.interview.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!interview) {
      return res.status(404).json({ error: 'Interview not found.' });
    }

    if (interview.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden. You do not have access to this interview.' });
    }

    return res.status(200).json({ interview });
  } catch (error) {
    console.error('Fetch interview error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/user/:userId', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.params.userId as string;
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    if (req.user.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const [interviews, total] = await Promise.all([
      prisma.interview.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
        feedback: true 
      }
      }),
      prisma.interview.count({ where: { userId } })
    ]);

    return res.status(200).json({
      interviews,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List interviews error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/:id/status', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    const validStatuses = ['PENDING', 'ACTIVE', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const interview = await prisma.interview.findUnique({ where: { id } });

    if (!interview) {
      return res.status(404).json({ error: 'Interview not found.' });
    }

    if (interview.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const updatedInterview = await prisma.interview.update({
      where: { id },
      data: { status }
    });

    return res.status(200).json({
      message: 'Interview status updated successfully.',
      interview: updatedInterview
    });
  } catch (error) {
    console.error('Update status error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;