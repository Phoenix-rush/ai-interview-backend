import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';
import { upload } from '../middlewares/uploadMiddleware';
import { PDFParse } from 'pdf-parse';
import { geminiModel } from '../config/gemini';

const router = Router();

// POST /api/v1/resume/upload
router.post('/upload', protect, upload.single('file'), async (req: AuthRequest, res: Response): Promise<any> => {
  let parser: PDFParse | null = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Please upload a PDF resume.' });
    }

    const userId = req.user.userId;
    const fileUrl = req.file.path;

    // Fetch PDF from Cloudinary and convert to buffer
    const response = await fetch(fileUrl);

    if (!response.ok) {
      console.error(`Failed to fetch PDF from storage. Status: ${response.status}, URL: ${fileUrl}`);
      return res.status(502).json({
        error: 'Could not retrieve the uploaded file from storage. Please try again.',
      });
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return res.status(502).json({
        error: 'The uploaded file appears to be empty. Please try uploading again.',
      });
    }

    const buffer = Buffer.from(arrayBuffer);

    // Extract text — pdf-parse v2 (class-based)
    parser = new PDFParse({ data: buffer });
    const pdfResult = await parser.getText();
    const extractedText = pdfResult.text;

    // Send to Gemini for structured parsing
    const prompt = `
      You are an expert ATS resume parser. Extract the following information from the provided resume text and return ONLY a valid JSON object (without any markdown wrappers like \`\`\`json).
      Structure required:
      {
        "name": "string",
        "skills": ["string", "string"],
        "experience": [{"company": "string", "role": "string", "duration": "string"}],
        "education": [{"institution": "string", "degree": "string", "year": "string"}],
        "projects": [{"name": "string", "description": "string"}]
      }
      Resume Text:
      ${extractedText}
    `;

    // Updated to use the centralized model
    const aiResult = await geminiModel.generateContent(prompt);

    const rawText = aiResult.response.text();

    if (!rawText) {
      throw new Error('Gemini did not return any text content for resume parsing.');
    }

    const aiResponseText = rawText.trim();

    const cleanJsonString = aiResponseText
      .replace(/```json/gi, '')
      .replace(/```/gi, '')
      .trim();

    const parsedData = JSON.parse(cleanJsonString);

    // Save to DB
    const resume = await prisma.resume.create({
      data: {
        userId,
        fileUrl,
        parsedData,
      },
    });

    return res.status(201).json({
      message: 'Resume uploaded, parsed, and saved successfully.',
      resume,
    });

  } catch (error: any) {
    console.error('Resume processing error:', error);
    return res.status(500).json({ error: 'Error during processing: ' + (error.message || 'Unknown error') });
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
});

// GET /api/v1/resume/:userId
router.get('/:userId', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.params.userId as string;

    if (req.user.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    const resume = await prisma.resume.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!resume) {
      return res.status(404).json({ error: 'No resume found for this user.' });
    }

    return res.status(200).json({ resume });

  } catch (error) {
    console.error('Resume fetch error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /api/v1/resume/:id
router.delete('/:id', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const resume = await prisma.resume.findUnique({ where: { id } });

    if (!resume) {
      return res.status(404).json({ error: 'Resume not found.' });
    }

    if (resume.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await prisma.resume.delete({ where: { id } });

    return res.status(200).json({ message: 'Resume deleted successfully.' });

  } catch (error) {
    console.error('Resume delete error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;