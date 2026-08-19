import { Router, Request, Response } from 'express';
import prisma from '../config/prisma';
import redisClient from '../config/redis';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    dbStatus = 'error';
  }

  try {
    if (!redisClient.isReady) {
      redisStatus = 'error';
    }
  } catch (error) {
    redisStatus = 'error';
  }

  const statusCode = (dbStatus === 'ok' && redisStatus === 'ok') ? 200 : 503;
  const overallStatus = statusCode === 200 ? 'ok' : 'degraded';

  res.status(statusCode).json({
    status: overallStatus,
    db: dbStatus,
    redis: redisStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

export default router;