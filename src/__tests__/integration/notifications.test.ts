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

describe('Notifications Integration Tests', () => {
  let token: string;
  let otherToken: string;
  let userId: string;
  let readNotificationId: string;
  let unreadNotificationId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Notif User', email: 'notifuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    userId = user.id;
    token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const otherUser = await prisma.user.create({
      data: { name: 'Other Notif User', email: 'othernotifuser@example.com', password: 'hashedpassword', role: 'USER' },
    });
    otherToken = jwt.sign({ userId: otherUser.id, role: otherUser.role }, process.env.JWT_SECRET || 'testsecret', { expiresIn: '15m' });

    const readNotif = await prisma.notification.create({
      data: { userId, type: 'WELCOME', message: 'Welcome!', read: true },
    });
    readNotificationId = readNotif.id;

    const unreadNotif = await prisma.notification.create({
      data: { userId, type: 'FEEDBACK_READY', message: 'Your feedback is ready!', read: false },
    });
    unreadNotificationId = unreadNotif.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email: { in: ['notifuser@example.com', 'othernotifuser@example.com'] } } });
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.quit();
  });

  describe('GET /api/v1/notifications', () => {
    it('should return notifications and unread count', async () => {
      const response = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.notifications.length).toBeGreaterThanOrEqual(2);
      expect(response.body.unreadCount).toBeGreaterThanOrEqual(1);
    });

    it('should return 401 without a token', async () => {
      const response = await request(app).get('/api/v1/notifications');
      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('should mark a notification as read', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${unreadNotificationId}/read`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.notification.read).toBe(true);
    });

    it('should return 404 for a non-existent notification', async () => {
      const response = await request(app)
        .patch('/api/v1/notifications/nonexistent-id/read')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it('should return 403 when marking another user\'s notification as read', async () => {
      const response = await request(app)
        .patch(`/api/v1/notifications/${readNotificationId}/read`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });
  });
});