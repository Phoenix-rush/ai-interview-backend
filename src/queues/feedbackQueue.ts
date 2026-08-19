import { Queue } from 'bullmq';

// Redis connection config (jo tune phase 1 me docker pe chalaya tha)
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Queue create kar rahe hain
export const feedbackQueue = new Queue('feedback-queue', { connection });