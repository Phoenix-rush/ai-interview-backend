import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection config (ab Upstash/Render pe URL use hoga)
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

// Queue create kar rahe hain
export const feedbackQueue = new Queue('feedback-queue', { connection });