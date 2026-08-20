import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../config/prisma';
import { sendEmail } from '../utils/email';
import { geminiModel } from '../config/gemini';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

export const feedbackWorker = new Worker('feedback-queue', async (job: Job) => {
  const { interviewId, userId } = job.data;
  console.log(`Processing feedback for interview: ${interviewId}`);

  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        answers: true,
        codeSubmissions: true
      }
    });

    if (!interview) throw new Error('Interview not found');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    let conversationContext = `Role: ${interview.role}\nDifficulty: ${interview.difficulty}\n\n`;
    
    interview.questions.forEach((q) => {
      const answer = interview.answers.find(a => a.questionId === q.id);
      const code = interview.codeSubmissions.find(c => c.questionId === q.id);
      
      conversationContext += `QID: ${q.id}\nQ${q.order} (${q.type}): ${q.question}\n`;
      if (answer) {
        conversationContext += `User's Spoken Answer: ${answer.skipped ? '[SKIPPED]' : answer.transcript}\n`;
      }
      if (code) {
        conversationContext += `User's Code Submission (${code.language}):\n${code.code}\nVerdict: ${code.verdict}\nOutput: ${code.stdout || 'None'}\n`;
      }
      conversationContext += `\n`;
    });

    const prompt = `
      You are an expert strict technical interviewer evaluating a candidate.
      Below is the complete transcript and code submissions of their interview.
      
      Interview Context:
      ${conversationContext}
      
      Evaluate the candidate strictly based on this 100-point rubric:
      - Communication (20 pts): Clarity, articulation, and structure of spoken answers.
      - Technical Accuracy (30 pts): Correctness of concepts and theory.
      - Problem Solving (30 pts): Logic, coding approach, and handling edge cases.
      - Confidence (10 pts): Lack of hesitation and directness in answers.
      - Time Management (10 pts): Kept answers concise and completed within expectations.
      
      Grade scale: A (85-100), B (70-84), C (55-69), D (0-54).
      
      Return ONLY a valid JSON object matching this exact structure (no markdown tags):
      {
        "scores": {
          "communication": number,
          "technical": number,
          "problemSolving": number,
          "confidence": number,
          "timeManagement": number,
          "total": number
        },
        "grade": "string (A, B, C or D)",
        "strengths": ["string", "string"],
        "weaknesses": ["string", "string"],
        "suggestions": {
          "communication": "string",
          "technical": "string",
          "problemSolving": "string"
        },
        "modelAnswers": {
          "Q1": "string (How the user SHOULD have answered)"
        },
        "questions": [
          {
            "question": "The exact question text",
            "answer": "What the user spoke or [SKIPPED]",
            "feedback": "Detailed evaluation and critique for this specific question",
            "score": number (out of 10)
          }
        ]
      }
    `;

    // Updated to use the centralized model
    const aiResult = await geminiModel.generateContent(prompt);
    const cleanJsonString = aiResult.response.text().replace(/```json/gi, '').replace(/```/gi, '').trim();
    const parsedFeedback = JSON.parse(cleanJsonString);

    await prisma.interviewFeedback.create({
      data: {
        interviewId,
        scores: parsedFeedback.scores,
        grade: parsedFeedback.grade,
        strengths: parsedFeedback.strengths,
        weaknesses: parsedFeedback.weaknesses,
        suggestions: parsedFeedback.suggestions,
        modelAnswers: parsedFeedback.modelAnswers,
        // 👈 NAYA: Saving questions array inside feedback (or JSON column compatibility)
        questions: parsedFeedback.questions || []
      } as any
    });

    await prisma.interview.update({
      where: { id: interviewId },
      data: { status: 'COMPLETED' }
    });

    const userStats = await prisma.userStats.findUnique({ where: { userId } });
    const newTotalScore = parsedFeedback.scores.total;

    if (userStats) {
      const newTotalInterviews = userStats.totalInterviews + 1;
      const newAvgScore = ((userStats.avgScore * userStats.totalInterviews) + newTotalScore) / newTotalInterviews;
      
      await prisma.userStats.update({
        where: { userId },
        data: {
          totalInterviews: newTotalInterviews,
          avgScore: newAvgScore,
        }
      });
    } else {
      await prisma.userStats.create({
        data: {
          userId,
          totalInterviews: 1,
          avgScore: newTotalScore,
          currentStreak: 1
        }
      });
    }

    await prisma.notification.create({
      data: {
        userId,
        type: 'FEEDBACK_READY',
        message: `Your interview feedback for ${interview.role} is ready! You scored a grade of ${parsedFeedback.grade}.`,
      }
    });

    sendEmail(
      user.email,
      'Your Interview Feedback is Ready!',
      `<h3>Hi ${user.name},</h3><p>Your AI mock interview feedback for the <b>${interview.role}</b> role has been generated.</p><p>You scored a grade of <b>${parsedFeedback.grade}</b>.</p><p>Log in to your dashboard to view detailed insights.</p>`
    );

    console.log(`Feedback generated and stats updated successfully for interview: ${interviewId}`);
    return { success: true };

  } catch (error) {
    console.error(`Error processing feedback for ${interviewId}:`, error);
    throw error;
  }
}, { connection });