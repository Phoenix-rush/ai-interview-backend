import request from 'supertest';
import app from '../../index';
import prisma from '../../config/prisma';
import redisClient from '../../config/redis';
import jwt from 'jsonwebtoken';

// Bypass the real Cloudinary/multer upload pipeline — inject a fake req.file instead
jest.mock('../../middlewares/uploadMiddleware', () => ({
  upload: {
    single: () => (req: any, _res: any, next: any) => {
      req.file = {
        path: 'https://res.cloudinary.com/demo/raw/upload/v1/ai_interview_resumes/resume_test.pdf',
      };
      next();
    },
  },
}));

// Bypass real PDF parsing
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({
      text: 'John Doe\nSkills: React, Node.js\nExperience: 2 years Frontend Developer',
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Bypass real Gemini call
jest.mock('../../config/gemini', () => ({
  geminiModel: {
    generateContent: jest.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            name: 'John Doe',
            skills: ['React', 'Node.js'],
            experience: [{ company: 'Acme', role: 'Frontend Developer', duration: '2 years' }],
            education: [{ institution: 'XYZ University', degree: 'B.Tech', year: '2022' }],
            projects: [{ name: 'Portfolio Site', description: 'Personal portfolio built with Next.js' }],
          }),
      },
    }),
  },
}));

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

// Bypass real network fetch of the uploaded PDF from Cloudinary
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 fake pdf content').buffer,
}) as any;

describe('Resume Integration Tests', () => {
  let token: string;
  let otherToken: string;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Resume User', email: 'resumeuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    userId = user.id;
    token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const otherUser = await prisma.user.create({
      data: { name: 'Other User', email: 'otherresumeuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    otherUserId = otherUser.id;
    otherToken = jwt.sign({ userId: otherUser.id, role: otherUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.resume.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('POST /api/v1/resume/upload', () => {
    it('should upload, parse, and save a resume', async () => {
      const response = await request(app)
        .post('/api/v1/resume/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), 'resume.pdf');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('resume');
      expect(response.body.resume.userId).toBe(userId);
      expect(response.body.resume.parsedData.name).toBe('John Doe');
      expect(response.body.resume.parsedData.skills).toContain('React');
    });

    it('should return 401 if no token is provided', async () => {
      const response = await request(app)
        .post('/api/v1/resume/upload')
        .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), 'resume.pdf');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/resume/:userId', () => {
    it("should fetch the user's latest resume", async () => {
      const response = await request(app)
        .get(`/api/v1/resume/${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('resume');
      expect(response.body.resume.userId).toBe(userId);
    });

    it('should return 403 when requesting another user\'s resume', async () => {
      const response = await request(app)
        .get(`/api/v1/resume/${userId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 404 when the user has no resume', async () => {
      const response = await request(app)
        .get(`/api/v1/resume/${otherUserId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/resume/:id', () => {
    it('should return 403 when deleting another user\'s resume', async () => {
      const resume = await prisma.resume.findFirst({ where: { userId } });

      const response = await request(app)
        .delete(`/api/v1/resume/${resume!.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 404 for a non-existent resume', async () => {
      const response = await request(app)
        .delete('/api/v1/resume/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it('should delete the resume successfully', async () => {
      const resume = await prisma.resume.findFirst({ where: { userId } });

      const response = await request(app)
        .delete(`/api/v1/resume/${resume!.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);

      const check = await prisma.resume.findUnique({ where: { id: resume!.id } });
      expect(check).toBeNull();
    });
  });
});