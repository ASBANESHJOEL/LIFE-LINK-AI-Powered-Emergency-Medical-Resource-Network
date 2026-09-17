import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getUserNotifications, markNotificationRead } from '../services/notificationService.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/notifications
 * Authenticated donor endpoint to fetch their in-app notification feed.
 */
router.get('/notifications', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { page, limit, unreadOnly } = req.query;

    const result = await getUserNotifications({
      userId: req.user.id,
      page,
      limit,
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1'
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch notifications'
    });
  }
});

/**
 * PATCH /api/notifications/:notificationId/read
 * Mark a notification as read. Verifies server-side ownership.
 */
router.patch('/notifications/:notificationId/read', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!UUID_RE.test(notificationId)) {
      return res.status(400).json({
        error: 'INVALID_NOTIFICATION_ID',
        message: 'notificationId must be a valid UUID'
      });
    }

    const updated = await markNotificationRead({
      notificationId,
      userId: req.user.id
    });

    return res.status(200).json({
      success: true,
      notification: updated
    });
  } catch (error) {
    console.error('Error marking notification read:', error);

    if (error.code === 'INVALID_ID') {
      return res.status(400).json({
        error: 'INVALID_NOTIFICATION_ID',
        message: 'notificationId must be a valid UUID'
      });
    }

    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found'
      });
    }

    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You are not authorized to update this notification'
      });
    }

    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to update notification'
    });
  }
});

export default router;
