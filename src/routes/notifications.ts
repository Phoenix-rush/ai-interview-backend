import { Router, Response } from 'express';
import prisma from '../config/prisma';
import { protect, AuthRequest } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });


    const unreadCount = notifications.filter(n => !n.read).length;


    return res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.patch('/:id/read', protect, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const notificationId = req.params.id as string;

    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    if (notification.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true }
    });

    return res.status(200).json({ message: 'Marked as read', notification: updatedNotification });
  } catch (error) {
    console.error('Update notification error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;