import prisma from '../config/prisma';
import logger from './logger';

export const logAudit = async (action: string, userId?: string, resource?: string, ip?: string) => {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId,
        resource,
        ip: ip || 'unknown',
      }
    });
  } catch (error) {
    logger.error(`Audit Log Error: ${error}`);
  }
};