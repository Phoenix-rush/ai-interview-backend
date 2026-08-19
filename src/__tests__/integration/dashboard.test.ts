import request from 'supertest';
import app from '../../index';
import prisma from '../../config/prisma';
import redisClient from '../../config/redis';
import jwt from 'jsonwebtoken';

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

describe('Dashboard Integration Tests', () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let emptyUserId: string;
  let interviewIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Dashboard User', email: 'dashboarduser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    userId = user.id;
    token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const emptyUser = await prisma.user.create({
      data: { name: 'Empty User', email: 'emptyuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    emptyUserId = emptyUser.id;
    otherToken = jwt.sign({ userId: emptyUser.id, role: emptyUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    // Two completed interviews with feedback so categoryAverages has data to compute
    const scoreSets = [
      { communication: 16, technical: 24, problemSolving: 22, confidence: 8, timeManagement: 9, total: 79 },
      { communication: 18, technical: 28, problemSolving: 26, confidence: 9, timeManagement: 10, total: 91 },
    ];

    for (const scores of scoreSets) {
      const interview = await prisma.interview.create({
        data: { userId, role: 'Frontend Developer', difficulty: 'Medium', duration: 30, status: 'COMPLETED' },
      });
      interviewIds.push(interview.id);

      await prisma.interviewFeedback.create({
        data: {
          interviewId: interview.id,
          scores,
          grade: scores.total >= 85 ? 'A' : 'B',
          strengths: ['Clear communication'],
          weaknesses: ['Needs deeper system design knowledge'],
          suggestions: { communication: 'Keep practicing', technical: 'Read more', problemSolving: 'Practice DSA' },
          modelAnswers: { Q1: 'A well structured answer would...' },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.interviewFeedback.deleteMany({ where: { interviewId: { in: interviewIds } } });
    await prisma.interview.deleteMany({ where: { id: { in: interviewIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, emptyUserId] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('GET /api/v1/dashboard/:userId', () => {
    it('should return stats, recentHistory and categoryAverages', async () => {
      const response = await request(app)
        .get(`/api/v1/dashboard/${userId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('recentHistory');
      expect(response.body).toHaveProperty('categoryAverages');

      expect(response.body.recentHistory).toHaveLength(2);
      expect(response.body.categoryAverages).toHaveLength(5);

      const communicationEntry = response.body.categoryAverages.find((c: any) => c.subject === 'Communication');
      expect(communicationEntry).toBeDefined();
      expect(communicationEntry.A).toBeCloseTo(17, 0); // average of 16 and 18
    });

    it('should return an empty categoryAverages array when the user has no completed interviews', async () => {
      const response = await request(app)
        .get(`/api/v1/dashboard/${emptyUserId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(200);
      expect(response.body.categoryAverages).toEqual([]);
      expect(response.body.recentHistory).toEqual([]);
      expect(response.body.stats.totalInterviews).toBe(0);
    });

    it('should return 403 when requesting another user\'s dashboard', async () => {
      const response = await request(app)
        .get(`/api/v1/dashboard/${userId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 if no token is provided', async () => {
      const response = await request(app).get(`/api/v1/dashboard/${userId}`);
      expect(response.status).toBe(401);
    });
  });
});