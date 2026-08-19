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

describe('Interview Answers Integration Tests', () => {
  let token: string;
  let otherToken: string;
  let userId: string;
  let interviewId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Answers User', email: 'answersuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    userId = user.id;
    token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const otherUser = await prisma.user.create({
      data: { name: 'Other Answers User', email: 'otheranswersuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    otherToken = jwt.sign({ userId: otherUser.id, role: otherUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const interview = await prisma.interview.create({
      data: { userId, role: 'Backend Developer', difficulty: 'Easy', duration: 20, status: 'ACTIVE' },
    });
    interviewId = interview.id;
  });

  afterAll(async () => {
    await prisma.interviewAnswer.deleteMany({ where: { interviewId } });
    await prisma.interview.deleteMany({ where: { id: interviewId } });
    await prisma.user.deleteMany({ where: { email: { in: ['answersuser@example.com', 'otheranswersuser@example.com'] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('POST /api/v1/answers', () => {
    it('should return 400 if interviewId or questionId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/answers')
        .set('Authorization', `Bearer ${token}`)
        .send({ transcript: 'Some answer' });

      expect(response.status).toBe(400);
    });

    it('should return 404 for a non-existent interview', async () => {
      const response = await request(app)
        .post('/api/v1/answers')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId: 'nonexistent-id', questionId: 'q1', transcript: 'Some answer' });

      expect(response.status).toBe(404);
    });

    it('should return 403 when saving an answer for someone else\'s interview', async () => {
      const response = await request(app)
        .post('/api/v1/answers')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ interviewId, questionId: 'q1', transcript: 'Some answer' });

      expect(response.status).toBe(403);
    });

    it('should save an answer successfully', async () => {
      const response = await request(app)
        .post('/api/v1/answers')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId, questionId: 'q1', transcript: 'React is a JS library.', duration: 45 });

      expect(response.status).toBe(201);
      expect(response.body.answer.transcript).toBe('React is a JS library.');
      expect(response.body.answer.skipped).toBe(false);
    });

    it('should default skipped to false and transcript to empty string when omitted', async () => {
      const response = await request(app)
        .post('/api/v1/answers')
        .set('Authorization', `Bearer ${token}`)
        .send({ interviewId, questionId: 'q2' });

      expect(response.status).toBe(201);
      expect(response.body.answer.transcript).toBe('');
      expect(response.body.answer.skipped).toBe(false);
    });
  });

  describe('GET /api/v1/answers/:interviewId', () => {
    it('should return all saved answers for the interview', async () => {
      const response = await request(app)
        .get(`/api/v1/answers/${interviewId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.answers.length).toBeGreaterThanOrEqual(2);
    });

    it('should return 403 for a user who does not own the interview', async () => {
      const response = await request(app)
        .get(`/api/v1/answers/${interviewId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 404 for a non-existent interview', async () => {
      const response = await request(app)
        .get('/api/v1/answers/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });
  });
});