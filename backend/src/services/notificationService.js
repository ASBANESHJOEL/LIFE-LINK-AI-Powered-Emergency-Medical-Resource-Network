import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { sendEmail } from './emailProvider.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Record notification lifecycle events in audit_logs without sensitive data.
 */
async function recordAuditLog({ actorUserId, action, entityId, metadata = {} }) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: actorUserId || null,
      action,
      entity_type: 'notification',
      entity_id: entityId,
      metadata,
      is_synthetic: false
    });
  } catch (err) {
    console.error(`Audit logging failed for ${action}:`, err.message || err);
  }
}

/**
 * Create or get an existing IN_APP notification for a donor dispatch.
 * Enforces idempotency via donor_dispatch_id and channel.
 */
export async function createInAppNotification({
  userId,
  dispatchId = null,
  requestId = null,
  title,
  body,
  metadata = {},
  actorUserId = null
}) {
  if (!userId) throw new Error('userId is required for in-app notification');

  // Check idempotency if dispatchId is provided
  if (dispatchId) {
    const { data: existing, error: findError } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('donor_dispatch_id', dispatchId)
      .eq('channel', 'IN_APP')
      .maybeSingle();

    if (findError) {
      const err = new Error(findError.message || 'Failed to check existing in-app notification');
      err.code = findError.code;
      throw err;
    }

    if (existing) {
      return existing;
    }
  }

  const { data: created, error: insertError } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: userId,
      donor_dispatch_id: dispatchId,
      request_id: requestId,
      channel: 'IN_APP',
      status: 'DELIVERED',
      title,
      body,
      metadata,
      sent_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (insertError) {
    // If unique constraint conflict occurred concurrently, return the existing record
    if (insertError.code === '23505' && dispatchId) {
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('donor_dispatch_id', dispatchId)
        .eq('channel', 'IN_APP')
        .maybeSingle();
      if (existing) return existing;
    }
    const err = new Error(insertError.message || 'Failed to create in-app notification');
    err.code = insertError.code;
    throw err;
  }

  await recordAuditLog({
    actorUserId: actorUserId || userId,
    action: 'DONOR_NOTIFICATION_CREATED',
    entityId: created.id,
    metadata: {
      channel: 'IN_APP',
      donor_dispatch_id: dispatchId,
      request_id: requestId
    }
  });

  return created;
}

/**
 * Create or reuse an EMAIL notification and attempt delivery.
 * If already SENT, avoids duplicate transmission. If FAILED, retries delivery.
 * Decoupled from dispatch creation: delivery failures update notification record to FAILED.
 */
export async function createEmailNotification({
  userId,
  toEmail,
  dispatchId = null,
  requestId = null,
  title,
  body,
  metadata = {},
  actorUserId = null
}) {
  if (!userId) throw new Error('userId is required for email notification');
  if (!toEmail) throw new Error('toEmail is required for email notification');

  let record = null;

  // Check idempotency if dispatchId is provided
  if (dispatchId) {
    const { data: existing, error: findError } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('donor_dispatch_id', dispatchId)
      .eq('channel', 'EMAIL')
      .maybeSingle();

    if (findError) {
      const err = new Error(findError.message || 'Failed to check existing email notification');
      err.code = findError.code;
      throw err;
    }

    if (existing) {
      // If already successfully sent, do not send duplicate email
      if (existing.status === 'SENT') {
        return existing;
      }
      record = existing;
    }
  }

  // Create initial record if not exists
  if (!record) {
    const { data: created, error: insertError } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: userId,
        donor_dispatch_id: dispatchId,
        request_id: requestId,
        channel: 'EMAIL',
        status: 'PENDING',
        title,
        body,
        metadata
      })
      .select('*')
      .single();

    if (insertError) {
      if (insertError.code === '23505' && dispatchId) {
        const { data: existing } = await supabaseAdmin
          .from('notifications')
          .select('*')
          .eq('donor_dispatch_id', dispatchId)
          .eq('channel', 'EMAIL')
          .maybeSingle();
        if (existing) {
          if (existing.status === 'SENT') return existing;
          record = existing;
        }
      } else {
        const err = new Error(insertError.message || 'Failed to initialize email notification record');
        err.code = insertError.code;
        throw err;
      }
    } else {
      record = created;
      await recordAuditLog({
        actorUserId: actorUserId || userId,
        action: 'DONOR_NOTIFICATION_CREATED',
        entityId: record.id,
        metadata: { channel: 'EMAIL', donor_dispatch_id: dispatchId, request_id: requestId }
      });
    }
  }

  // Attempt Email Delivery via Email Provider Abstraction
  try {
    const emailResult = await sendEmail({
      to: toEmail,
      subject: title,
      html: `<p>${body}</p>`,
      text: body
    });

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('notifications')
      .update({
        status: 'SENT',
        sent_at: nowIso,
        failed_at: null,
        failure_reason: null,
        metadata: {
          ...record.metadata,
          message_id: emailResult?.messageId || null,
          simulated: Boolean(emailResult?.simulated)
        }
      })
      .eq('id', record.id)
      .select('*')
      .single();

    if (!updateError && updated) {
      record = updated;
    } else {
      record.status = 'SENT';
      record.sent_at = nowIso;
    }

    await recordAuditLog({
      actorUserId: actorUserId || userId,
      action: 'DONOR_NOTIFICATION_SENT',
      entityId: record.id,
      metadata: {
        channel: 'EMAIL',
        donor_dispatch_id: dispatchId,
        message_id: emailResult?.messageId || null
      }
    });

    return record;
  } catch (emailErr) {
    const failedIso = new Date().toISOString();
    const reason = emailErr.message || 'Email delivery failed';

    const { data: failedRecord } = await supabaseAdmin
      .from('notifications')
      .update({
        status: 'FAILED',
        failed_at: failedIso,
        failure_reason: reason
      })
      .eq('id', record.id)
      .select('*')
      .single();

    await recordAuditLog({
      actorUserId: actorUserId || userId,
      action: 'DONOR_NOTIFICATION_FAILED',
      entityId: record.id,
      metadata: {
        channel: 'EMAIL',
        donor_dispatch_id: dispatchId,
        failure_reason: reason
      }
    });

    return failedRecord || { ...record, status: 'FAILED', failed_at: failedIso, failure_reason: reason };
  }
}

/**
 * Format privacy-conscious notification content without patient-sensitive fields.
 */
export function formatEmergencyNotificationContent(request) {
  const bloodGroup = request.blood_group || 'Blood';
  const resourceType = request.resource_type || 'Resource';
  const urgency = request.urgency || 'HIGH';

  const title = `LIFE-LINK Emergency Blood Request: ${bloodGroup}`;
  const body = `Emergency alert: An urgent request for ${bloodGroup} (${resourceType}, urgency: ${urgency}) requires your immediate attention. Please open the LIFE-LINK app to accept or decline.`;

  return { title, body };
}

/**
 * Send batch notifications (IN_APP & EMAIL) for newly created donor dispatches.
 * Strictly decoupled: notification failures do NOT delete or roll back valid dispatches.
 */
export async function sendDispatchBatchNotifications({ request, dispatches, actorUserId = null }) {
  if (!dispatches?.length) return { notified: false, total: 0, results: [] };

  const donorIds = Array.from(new Set(dispatches.map((d) => d.donor_id).filter(Boolean)));
  if (!donorIds.length) return { notified: false, total: 0, results: [] };

  // Resolve donor user_id from public.donors
  const { data: donors, error: donorError } = await supabaseAdmin
    .from('donors')
    .select('id, user_id, name')
    .in('id', donorIds);

  if (donorError) {
    console.error('Failed to resolve donor user accounts for notifications:', donorError);
    return { notified: false, total: dispatches.length, error: 'FAILED_DONOR_LOOKUP', results: [] };
  }

  const donorList = Array.isArray(donors) ? donors : (donors ? [donors] : []);
  const donorMap = new Map(donorList.map((d) => [d.id, d]));
  const userIds = Array.from(new Set(donorList.map((d) => d.user_id).filter(Boolean)));

  // Resolve donor email from public.users
  let userMap = new Map();
  if (userIds.length) {
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .in('id', userIds);

    if (!userError && users) {
      const userList = Array.isArray(users) ? users : [users];
      userMap = new Map(userList.map((u) => [u.id, u]));
    }
  }

  const { title, body } = formatEmergencyNotificationContent(request);
  const results = [];
  const successfulNotifiedDispatchIds = [];

  for (const dispatch of dispatches) {
    const donor = donorMap.get(dispatch.donor_id);
    if (!donor?.user_id) continue;

    const user = userMap.get(donor.user_id);
    const toEmail = user?.email || null;

    let inAppResult = null;
    let emailResult = null;

    try {
      inAppResult = await createInAppNotification({
        userId: donor.user_id,
        dispatchId: dispatch.id,
        requestId: request.id,
        title,
        body,
        metadata: {
          blood_group: request.blood_group,
          resource_type: request.resource_type,
          urgency: request.urgency
        },
        actorUserId
      });
    } catch (inAppErr) {
      console.error(`In-app notification failed for dispatch ${dispatch.id}:`, inAppErr.message);
    }

    if (toEmail) {
      try {
        emailResult = await createEmailNotification({
          userId: donor.user_id,
          toEmail,
          dispatchId: dispatch.id,
          requestId: request.id,
          title,
          body,
          metadata: {
            blood_group: request.blood_group,
            resource_type: request.resource_type,
            urgency: request.urgency
          },
          actorUserId
        });
      } catch (emailErr) {
        console.error(`Email notification failed for dispatch ${dispatch.id}:`, emailErr.message);
      }
    }

    if (inAppResult || emailResult?.status === 'SENT') {
      successfulNotifiedDispatchIds.push(dispatch.id);
    }

    results.push({
      dispatchId: dispatch.id,
      donorId: dispatch.donor_id,
      inApp: inAppResult ? inAppResult.status : 'FAILED',
      email: emailResult ? emailResult.status : (toEmail ? 'FAILED' : 'NO_EMAIL')
    });
  }

  // Mark successful dispatches as NOTIFIED in database
  if (successfulNotifiedDispatchIds.length) {
    try {
      await supabaseAdmin
        .from('donor_dispatches')
        .update({
          status: 'NOTIFIED',
          notified_at: new Date().toISOString()
        })
        .in('id', successfulNotifiedDispatchIds)
        .eq('status', 'PENDING');
    } catch (updateErr) {
      console.error('Failed to update dispatch notified status:', updateErr);
    }
  }

  return {
    notified: successfulNotifiedDispatchIds.length > 0,
    total: dispatches.length,
    successfulCount: successfulNotifiedDispatchIds.length,
    results
  };
}

/**
 * Retrieve paginated notifications for the authenticated user.
 */
export async function getUserNotifications({ userId, page = 1, limit = 20, unreadOnly = false }) {
  if (!userId) throw new Error('userId is required');

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  let query = supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1);

  if (unreadOnly) {
    query = query.eq('channel', 'IN_APP').is('read_at', null);
  }

  const { data: notifications, count: total, error } = await query;

  if (error) {
    const err = new Error(error.message || 'Failed to retrieve notifications');
    err.code = error.code;
    throw err;
  }

  // Count unread in-app notifications
  const { count: unreadCount, error: countErr } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('channel', 'IN_APP')
    .is('read_at', null);

  return {
    notifications: notifications || [],
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: total || 0,
      unreadCount: countErr ? 0 : (unreadCount || 0)
    }
  };
}

/**
 * Mark a user notification as read.
 * Enforces ownership: only updates if user_id matches authenticated userId.
 */
export async function markNotificationRead({ notificationId, userId }) {
  if (!UUID_RE.test(notificationId)) {
    const err = new Error('Invalid notificationId UUID');
    err.code = 'INVALID_ID';
    throw err;
  }

  const { data: notification, error: lookupError } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, read_at, status')
    .eq('id', notificationId)
    .maybeSingle();

  if (lookupError) {
    const err = new Error(lookupError.message || 'Database error looking up notification');
    err.code = lookupError.code;
    throw err;
  }

  if (!notification) {
    const err = new Error('Notification not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (notification.user_id !== userId) {
    const err = new Error('You are not authorized to access this notification');
    err.code = 'FORBIDDEN';
    throw err;
  }

  if (notification.read_at) {
    return notification; // Already marked as read
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('notifications')
    .update({
      status: 'READ',
      read_at: nowIso
    })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (updateError) {
    const err = new Error(updateError.message || 'Failed to update notification');
    err.code = updateError.code;
    throw err;
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'DONOR_NOTIFICATION_READ',
    entityId: notificationId,
    metadata: { user_id: userId, read_at: nowIso }
  });

  return updated;
}
