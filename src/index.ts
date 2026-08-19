import 'dotenv/config'
import express, { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';

import { createServer } from 'http';
import { Server } from 'socket.io';

import authRoutes from './routes/auth'
import resumeRoutes from './routes/resume';
import interviewRoutes from './routes/interview';
import answerRoutes from './routes/answers';
import initializeSocket from './sockets/interviewSocket';
import codeRoutes from './routes/code';
import './workers/feedbackWorker';
import dashboardRoutes from './routes/dashboard';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin';
import feedbackRoutes from './routes/feedback';
import userRoutes from './routes/user'
import { sanitizeInput } from './middlewares/sanitizeInput';


import morgan from 'morgan';
import logger from './utils/logger';
import { errorHandler } from './middlewares/errorHandler';
import healthRoute from './routes/health';
import metricsRoute, { httpRequestDurationMicroseconds } from './routes/metrics';

const app = express();
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0, 
  profilesSampleRate: 1.0,
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

app.use(helmet());
app.use(morgan('combined', { 
  stream: { write: (message) => logger.info(message.trim()) } 
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again in 15 minutes!' }
});
app.use('/api', limiter); 

app.use(express.json());

// sanitizeInput must NOT touch the code execution route — user-submitted
// source code legitimately contains unescaped <, >, & (C++ streams/templates,
// comparisons, generics). Running it through HTML-sanitization corrupts the
// code before it ever reaches the sandbox (e.g. "#include <iostream>" and
// "cout << x" get mangled into HTML entities and fail to compile).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v1/code')) return next();
  return sanitizeInput(req, res, next);
});

app.use('/metrics', metricsRoute);

app.use(hpp());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    httpRequestDurationMicroseconds.labels(req.method, route, res.statusCode.toString()).observe(duration);
  });
  next();
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/resume', resumeRoutes);
app.use('/api/v1/interview', interviewRoutes);
app.use('/api/v1/answers', answerRoutes);
app.use('/api/v1/code', codeRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/health', healthRoute);
app.use('/api/v1/feedback', feedbackRoutes);
app.use('/api/v1/user', userRoutes)

initializeSocket(io);
const PORT = process.env.PORT || 5000;

app.get('/', (req: Request, res: Response) => {
  res.send('AI Interview Platform API is running! 🚀🛡️');
});
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// Only listen if not running under tests
if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Socket.io is also running and ready for connections');
  });
}

const shutdown = () => {
  logger.info('🛑 SIGTERM/SIGINT received. Shutting down gracefully...');
  
  httpServer.close(async () => {
    logger.info('HTTP server closed.');
    
    logger.info('All connections closed. Exiting process.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Force shutting down after 10 seconds timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown); 

export default app;