import request from 'supertest';
import app from '../../index';
import prisma from '../../config/prisma';
import redisClient from '../../config/redis';
import jwt from 'jsonwebtoken';

jest.mock('../../config/gemini', () => ({
  geminiModel: {
    generateContent: jest.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify([
          { question: "What is React?", type: "CONCEPTUAL" },
          { question: "Write a function to reverse a string.", type: "CODING" }
        ])
      }
    })
  }
}));

// ✅ Redis ko mock kiya taaki test real Redis pe depend na kare
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    isOpen: false,
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  }
}));

describe('Interview Integration Tests', () => {
  let token: string;
  let testUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedpassword',
        role: 'USER'
      }
    });
    testUserId = user.id;

    await prisma.resume.create({
      data: {
        userId: user.id,
        fileUrl: 'https://example.com/dummy-resume.pdf',
        parsedData: {
          skills: ['React', 'JavaScript', 'Node.js'],
          experience: '2 years as Frontend Developer',
          education: 'B.Tech Computer Science'
        }
      }
    });

    token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'testsecret',
      { expiresIn: '15m' }
    );
  });

  afterAll(async () => {
  // ✅ Scoped to only this test's data — Cascade delete handles
  // interviewQuestion automatically via the schema's onDelete: Cascade
  await prisma.interview.deleteMany({ where: { userId: testUserId } });
  await prisma.resume.deleteMany({ where: { userId: testUserId } });
  await prisma.user.deleteMany({ where: { email: 'test@example.com' } });
  await prisma.$disconnect();

  if (redisClient.isOpen) {
    await redisClient.quit();
  }
});

  describe('POST /api/v1/interview/create', () => {
    it('should successfully create an interview and generate questions', async () => {
      const response = await request(app)
        .post('/api/v1/interview/create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          role: 'Frontend Developer',
          difficulty: 'Medium',
          duration: 30
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('interview');
      expect(response.body.interview.role).toBe('Frontend Developer');
      expect(response.body.interview.questions).toHaveLength(2);
    });

    it('should fail if required fields are missing', async () => {
      const response = await request(app)
        .post('/api/v1/interview/create')
        .set('Authorization', `Bearer ${token}`)
        .send({
          role: 'Frontend Developer'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 if token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/interview/create')
        .send({
          role: 'Frontend Developer',
          difficulty: 'Medium',
          duration: 30
        });

      expect(response.status).toBe(401);
    });
  });
});