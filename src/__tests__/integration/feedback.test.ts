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

// Don't let the real BullMQ Queue try to talk to Redis — just record calls
jest.mock('../../queues/feedbackQueue', () => ({
  feedbackQueue: {
    add: jest.fn().mockResolvedValue(undefined),
  },
}));

import { feedbackQueue } from '../../queues/feedbackQueue';

describe('Feedback Integration Tests', () => {
  let token: string;
  let otherToken: string;
  let userId: string;
  let interviewId: string;
  let interviewWithFeedbackId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Feedback User', email: 'feedbackuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    userId = user.id;
    token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const otherUser = await prisma.user.create({
      data: { name: 'Other Feedback User', email: 'otherfeedbackuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    otherToken = jwt.sign({ userId: otherUser.id, role: otherUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const interview = await prisma.interview.create({
      data: { userId, role: 'Frontend Developer', difficulty: 'Medium', duration: 30, status: 'ACTIVE' },
    });
    interviewId = interview.id;

    const interviewWithFeedback = await prisma.interview.create({
      data: { userId, role: 'Backend Developer', difficulty: 'Hard', duration: 45, status: 'COMPLETED' },
    });
    interviewWithFeedbackId = interviewWithFeedback.id;

    await prisma.interviewFeedback.create({
      data: {
        interviewId: interviewWithFeedbackId,
        scores: { communication: 15, technical: 25, problemSolving: 24, confidence: 8, timeManagement: 9, total: 81 },
        grade: 'B',
        strengths: ['Solid fundamentals'],
        weaknesses: ['Could be more concise'],
        suggestions: { communication: 'Be more concise', technical: 'Review edge cases', problemSolving: 'Practice more' },
        modelAnswers: { Q1: 'An ideal answer would cover...' },
        questions: [{ question: 'What is a closure?', answer: 'A function with access to outer scope', feedback: 'Good answer', score: 8 }],
      },
    });
  });

  afterAll(async () => {
    await prisma.interviewFeedback.deleteMany({ where: { interviewId: { in: [interviewId, interviewWithFeedbackId] } } });
    await prisma.interview.deleteMany({ where: { id: { in: [interviewId, interviewWithFeedbackId] } } });
    await prisma.user.deleteMany({ where: { email: { in: ['feedbackuser@example.com', 'otherfeedbackuser@example.com'] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  beforeEach(() => {
    (feedbackQueue.add as jest.Mock).mockClear();
  });

  describe('POST /api/v1/feedback/generate', () => {
    it('should return 400 if interviewId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 403 for a non-existent interview', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId: 'nonexistent-id' });

      expect(response.status).toBe(403);
    });

    it('should return 403 when queuing feedback for someone else\'s interview', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ interviewId });

      expect(response.status).toBe(403);
    });

    it('should return 400 if feedback already exists for the interview', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId: interviewWithFeedbackId });

      expect(response.status).toBe(400);
      expect(feedbackQueue.add).not.toHaveBeenCalled();
    });

    it('should queue feedback generation successfully', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId });

      expect(response.status).toBe(202);
      expect(feedbackQueue.add).toHaveBeenCalledWith('generate-feedback', { interviewId, userId });
    });

    it('should return 401 if no token is provided', async () => {
      const response = await request(app)
        .post('/api/v1/feedback/generate')
        .send({ interviewId });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/feedback/status/:interviewId', () => {
    it('should return PROCESSING when feedback does not exist yet', async () => {
      const response = await request(app)
        .get(`/api/v1/feedback/status/${interviewId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('PROCESSING');
      expect(response.body.feedback).toBeUndefined();
    });

    it('should return READY with the feedback payload when it exists', async () => {
      const response = await request(app)
        .get(`/api/v1/feedback/status/${interviewWithFeedbackId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('READY');
      expect(response.body.feedback.grade).toBe('B');
      expect(response.body.feedback.questions).toHaveLength(1);
    });

    it('should return 401 if no token is provided', async () => {
      const response = await request(app).get(`/api/v1/feedback/status/${interviewId}`);
      expect(response.status).toBe(401);
    });
  });
});