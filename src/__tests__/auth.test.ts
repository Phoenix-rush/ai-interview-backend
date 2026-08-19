import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: mockDeep<PrismaClient>(),
}));
import prisma from '../config/prisma';
const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('bcrypt', () => ({
    genSalt: jest.fn().mockResolvedValue('fake-salt'),
    compare: jest.fn().mockResolvedValue(true),
    hash: jest.fn().mockResolvedValue('hashed-password'),
}), { virtual: true });

jest.mock('bcryptjs', () => ({
    genSalt: jest.fn().mockResolvedValue('fake-salt'),
    compare: jest.fn().mockResolvedValue(true),
    hash: jest.fn().mockResolvedValue('hashed-password'),
}), { virtual: true });

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mocked-jwt-token'),
  verify: jest.fn().mockReturnValue({ userId: 'test-user-id' }),
}), { virtual: true });

jest.mock('../config/redis', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }
}));

import authRoutes from '../routes/auth';
const app = express();
app.use(express.json());
app.use('/api/v1/auth', authRoutes);

describe('Auth API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashed-password',
        role: 'USER',
        banned: false,
        createdAt: new Date(),
      } as any);
      prismaMock.notification.create.mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Test User', email: 'test@example.com', password: 'Password123' });

      expect(response.status).toBe(201);
      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    });

    it('should return 400 if email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-id', email: 'test@example.com' } as any);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ name: 'Another User', email: 'test@example.com', password: 'Password123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email is already registered');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully and return tokens', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        password: 'hashed-password',
        banned: false
      } as any);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'Password123' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });

    it('should return 403 if user is banned', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'banned-user-id',
        email: 'banned@example.com',
        banned: true
      } as any);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'banned@example.com', password: 'Password123' });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should return 400 if no refresh token is provided', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'some-valid-token' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Logged out successfully');
    });
  });
});