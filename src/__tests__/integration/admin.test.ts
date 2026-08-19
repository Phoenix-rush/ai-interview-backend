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

describe('Admin Panel Integration Tests', () => {
  let adminToken: string;
  let userToken: string;
  let adminId: string;
  let normalUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin User', email: 'adminuser@example.com', password: 'hashedpassword', role: 'ADMIN' },
    });
    adminId = admin.id;
    adminToken = jwt.sign({ userId: admin.id, role: admin.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const normalUser = await prisma.user.create({
      data: { name: 'Normal User', email: 'normaluser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    normalUserId = normalUser.id;
    userToken = jwt.sign({ userId: normalUser.id, role: normalUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [adminId, normalUserId] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('RBAC enforcement', () => {
    it('should return 403 for a non-admin hitting /admin/stats', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(403);
    });

    it('should return 401 for an unauthenticated request', async () => {
      const response = await request(app).get('/api/v1/admin/stats');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/admin/stats', () => {
    it('should return platform stats for an admin', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('totalUsers');
      expect(response.body).toHaveProperty('totalInterviews');
      expect(response.body).toHaveProperty('completedInterviews');
      expect(response.body).toHaveProperty('totalFeedback');
      expect(response.body.totalUsers).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/admin/users', () => {
    it('should return a paginated user list for an admin', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.users)).toBe(true);
      const emails = response.body.users.map((u: any) => u.email);
      expect(emails).toContain('normaluser@example.com');
    });
  });

  describe('PATCH /api/v1/admin/users/:id/ban', () => {
    it('should ban a user', async () => {
      const response = await request(app)
        .patch(`/api/v1/admin/users/${normalUserId}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ banned: true });

      expect(response.status).toBe(200);
      expect(response.body.user.banned).toBe(true);

      const banned = await prisma.user.findUnique({ where: { id: normalUserId } });
      expect(banned?.banned).toBe(true);
    });

    it('should reject a non-boolean banned value', async () => {
      const response = await request(app)
        .patch(`/api/v1/admin/users/${normalUserId}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ banned: 'yes' });

      expect(response.status).toBe(400);
    });

    it('should unban a user', async () => {
      const response = await request(app)
        .patch(`/api/v1/admin/users/${normalUserId}/ban`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ banned: false });

      expect(response.status).toBe(200);
      expect(response.body.user.banned).toBe(false);
    });

    it('should return 403 when a non-admin tries to ban a user', async () => {
      const response = await request(app)
        .patch(`/api/v1/admin/users/${normalUserId}/ban`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ banned: true });

      expect(response.status).toBe(403);
    });
  });
});