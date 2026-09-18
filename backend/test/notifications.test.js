import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';

const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const {
  createInAppNotification,
  createEmailNotification,
  sendDispatchBatchNotifications,
  getUserNotifications,
  markNotificationRead,
  formatEmergencyNotificationContent
} = await import('../src/services/notificationService.js');
const { setEmailSender, resetEmailSender } = await import('../src/services/emailProvider.js');
const { createNextDonorDispatchBatch } = await import('../src/services/donorDispatchService.js');
const { default: app } = await import('../src/app.js');

const DONOR_A_USER_ID = '11111111-1111-4000-8000-000000000001';
const DONOR_B_USER_ID = '22222222-2222-4000-8000-000000000002';
const HOSPITAL_USER_ID = '33333333-3333-4000-8000-000000000003';
const VALID_REQUEST_ID = '44444444-4444-4000-8000-000000000004';
const VALID_DISPATCH_ID = '55555555-5555-4000-8000-000000000005';

// Mock in-memory database store
const db = {
  users: {
    [DONOR_A_USER_ID]: { id: DONOR_A_USER_ID, email: 'donor.a@test.org', role: 'DONOR', is_active: true },
    [DONOR_B_USER_ID]: { id: DONOR_B_USER_ID, email: 'donor.b@test.org', role: 'DONOR', is_active: true },
    [HOSPITAL_USER_ID]: { id: HOSPITAL_USER_ID, email: 'hosp@test.org', role: 'HOSPITAL', is_active: true }
  },
  donors: {
    'donor-a': { id: 'donor-a', user_id: DONOR_A_USER_ID, name: 'Donor Alpha', verified: true, availability_status: 'AVAILABLE', eligibility_status: 'ELIGIBLE' },
    'donor-b': { id: 'donor-b', user_id: DONOR_B_USER_ID, name: 'Donor Beta', verified: true, availability_status: 'AVAILABLE', eligibility_status: 'ELIGIBLE' }
  },
  notifications: [],
  donor_dispatches: [],
  audit_logs: []
};

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  baseUrl = await new Promise((resolve) => {
    server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  // Mock auth.getUser
  supabaseAdmin.auth.getUser = async (token) => {
    if (token === 'token-donor-a') return { data: { user: { id: DONOR_A_USER_ID } }, error: null };
    if (token === 'token-donor-b') return { data: { user: { id: DONOR_B_USER_ID } }, error: null };
    if (token === 'token-hospital') return { data: { user: { id: HOSPITAL_USER_ID } }, error: null };
    return { data: { user: null }, error: new Error('Invalid token') };
  };

  // Mock supabaseAdmin.from
  const origFrom = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table === 'users') {
      const qb = {
        select: () => qb,
        eq: (f, v) => {
          qb._eq = qb._eq || {};
          qb._eq[f] = v;
          return qb;
        },
        in: (f, vals) => {
          qb._in = qb._in || {};
          qb._in[f] = vals;
          return qb;
        },
        maybeSingle: async () => {
          const user = db.users[qb._eq?.id];
          return { data: user || null, error: null };
        },
        then: (resolve) => {
          let rows = Object.values(db.users);
          if (qb._in?.id) rows = rows.filter((u) => qb._in.id.includes(u.id));
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'donors') {
      const qb = {
        select: () => qb,
        in: (f, vals) => {
          qb._in = qb._in || {};
          qb._in[f] = vals;
          return qb;
        },
        then: (resolve) => {
          let rows = Object.values(db.donors);
          if (qb._in?.id) rows = rows.filter((d) => qb._in.id.includes(d.id));
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'organization_members') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'org-mem-1',
                  organization_type: 'HOSPITAL',
                  hospital_id: 'hosp-1',
                  membership_role: 'ADMIN',
                  is_active: true,
                  hospitals: { id: 'hosp-1', hospital_name: 'Test Hospital' }
                },
                error: null
              })
            })
          })
        })
      };
    }

    if (table === 'notifications') {
      const qb = {
        _filters: {},
        select: (_cols, opts) => {
          qb._opts = opts;
          return qb;
        },
        eq: (f, v) => {
          qb._filters[f] = v;
          return qb;
        },
        is: (f, v) => {
          qb._is = qb._is || {};
          qb._is[f] = v;
          return qb;
        },
        order: () => qb,
        range: (start, end) => {
          qb._range = [start, end];
          return qb;
        },
        limit: (n) => {
          qb._limit = n;
          return qb;
        },
        maybeSingle: async () => {
          let match = db.notifications.find((n) => {
            for (const [k, v] of Object.entries(qb._filters)) {
              if (n[k] !== v) return false;
            }
            return true;
          });
          return { data: match ? { ...match } : null, error: null };
        },
        single: async () => {
          const res = await qb.maybeSingle();
          if (!res.data) return { data: null, error: new Error('Not found') };
          return res;
        },
        insert: (rowOrRows) => {
          const items = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const created = [];
          for (const item of items) {
            // Check unique index constraint (donor_dispatch_id, channel)
            if (item.donor_dispatch_id) {
              const conflict = db.notifications.find(
                (n) => n.donor_dispatch_id === item.donor_dispatch_id && n.channel === item.channel
              );
              if (conflict) {
                const err = new Error('duplicate key value violates unique constraint');
                err.code = '23505';
                return {
                  select: () => ({
                    single: async () => ({ data: null, error: err })
                  }),
                  then: (resolve) => resolve({ data: null, error: err })
                };
              }
            }

            const notif = {
              id: item.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              created_at: new Date().toISOString(),
              sent_at: null,
              read_at: null,
              failed_at: null,
              failure_reason: null,
              metadata: {},
              ...item
            };
            db.notifications.push(notif);
            created.push(notif);
          }

          return {
            select: () => ({
              single: async () => ({ data: { ...created[0] }, error: null })
            }),
            then: (resolve) => resolve({ data: created, error: null })
          };
        },
        update: (updates) => {
          return {
            eq: (f, v) => {
              qb._updateEq = qb._updateEq || {};
              qb._updateEq[f] = v;
              return {
                eq: (f2, v2) => {
                  qb._updateEq[f2] = v2;
                  return {
                    select: () => ({
                      single: async () => {
                        const target = db.notifications.find((n) => {
                          for (const [k, val] of Object.entries(qb._updateEq)) {
                            if (n[k] !== val) return false;
                          }
                          return true;
                        });
                        if (target) {
                          Object.assign(target, updates);
                          return { data: { ...target }, error: null };
                        }
                        return { data: null, error: new Error('Update target not found') };
                      }
                    })
                  };
                },
                select: () => ({
                  single: async () => {
                    const target = db.notifications.find((n) => {
                      for (const [k, val] of Object.entries(qb._updateEq)) {
                        if (n[k] !== val) return false;
                      }
                      return true;
                    });
                    if (target) {
                      Object.assign(target, updates);
                      return { data: { ...target }, error: null };
                    }
                    return { data: null, error: new Error('Update target not found') };
                  }
                })
              };
            }
          };
        },
        then: (resolve) => {
          let rows = db.notifications.filter((n) => {
            for (const [k, v] of Object.entries(qb._filters)) {
              if (n[k] !== v) return false;
            }
            if (qb._is) {
              for (const [k, v] of Object.entries(qb._is)) {
                if (v === null && n[k] !== null) return false;
              }
            }
            return true;
          });

          const count = rows.length;
          if (qb._opts?.head) {
            return resolve({ data: [], count, error: null });
          }

          if (qb._range) {
            rows = rows.slice(qb._range[0], qb._range[1] + 1);
          } else if (qb._limit) {
            rows = rows.slice(0, qb._limit);
          }

          return resolve({ data: rows.map((r) => ({ ...r })), count, error: null });
        }
      };
      return qb;
    }

    if (table === 'donor_dispatches') {
      const qb = {
        update: (updates) => ({
          in: (f, vals) => ({
            eq: () => {
              for (const d of db.donor_dispatches) {
                if (vals.includes(d.id)) Object.assign(d, updates);
              }
              return Promise.resolve({ error: null });
            }
          })
        })
      };
      return qb;
    }

    if (table === 'audit_logs') {
      return {
        insert: (row) => {
          db.audit_logs.push(row);
          return Promise.resolve({ error: null });
        }
      };
    }

    return origFrom.call(supabaseAdmin, table);
  };
});

after(() => {
  resetEmailSender();
  server?.close();
});

// Helper for API tests
async function apiRequest(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// ==========================================
// 1. Security & Authentication Boundaries
// ==========================================
test('GET /api/notifications: rejects unauthenticated request with 401', async () => {
  const { status, body } = await apiRequest('/api/notifications');
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('GET /api/notifications: rejects non-DONOR role (HOSPITAL) with 403', async () => {
  const { status, body } = await apiRequest('/api/notifications', {}, 'token-hospital');
  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('PATCH /api/notifications/:id/read: rejects unauthenticated request with 401', async () => {
  const { status, body } = await apiRequest('/api/notifications/00000000-0000-4000-8000-000000000000/read', {
    method: 'PATCH'
  });
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('PATCH /api/notifications/:id/read: rejects non-DONOR role with 403', async () => {
  const { status, body } = await apiRequest(
    '/api/notifications/00000000-0000-4000-8000-000000000000/read',
    { method: 'PATCH' },
    'token-hospital'
  );
  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('PATCH /api/notifications/:id/read: rejects malformed UUID with 400', async () => {
  const { status, body } = await apiRequest('/api/notifications/not-a-uuid/read', { method: 'PATCH' }, 'token-donor-a');
  assert.equal(status, 400);
  assert.equal(body.error, 'INVALID_NOTIFICATION_ID');
});

// ==========================================
// 2. Ownership & Cross-User Privacy (RLS Enforcement)
// ==========================================
test('Ownership: donor cannot read another donor’s notifications', async () => {
  db.notifications = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      user_id: DONOR_B_USER_ID,
      channel: 'IN_APP',
      status: 'DELIVERED',
      title: 'Confidential B',
      body: 'Body B',
      created_at: new Date().toISOString()
    }
  ];

  const { status, body } = await apiRequest('/api/notifications', {}, 'token-donor-a');
  assert.equal(status, 200);
  assert.equal(body.notifications.length, 0);
  assert.equal(body.pagination.total, 0);
});

test('Ownership: donor cannot mark another donor’s notification as read (403)', async () => {
  db.notifications = [
    {
      id: '20000000-0000-4000-8000-000000000002',
      user_id: DONOR_B_USER_ID,
      channel: 'IN_APP',
      status: 'DELIVERED',
      title: 'Donor B Alert',
      body: 'Body B',
      read_at: null
    }
  ];

  const { status, body } = await apiRequest(
    '/api/notifications/20000000-0000-4000-8000-000000000002/read',
    { method: 'PATCH' },
    'token-donor-a'
  );

  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('markNotificationRead: owner successfully marks notification as read', async () => {
  const notifId = '30000000-0000-4000-8000-000000000003';
  db.notifications = [
    {
      id: notifId,
      user_id: DONOR_A_USER_ID,
      channel: 'IN_APP',
      status: 'DELIVERED',
      title: 'Donor A Alert',
      body: 'Please respond',
      read_at: null
    }
  ];

  const { status, body } = await apiRequest(`/api/notifications/${notifId}/read`, { method: 'PATCH' }, 'token-donor-a');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.notification.status, 'READ');
  assert.ok(body.notification.read_at);

  const stored = db.notifications.find((n) => n.id === notifId);
  assert.equal(stored.status, 'READ');
  assert.ok(stored.read_at);
});

// ==========================================
// 3. Notification Service & In-App Feed
// ==========================================
test('getUserNotifications: pagination and unread count are accurately returned', async () => {
  db.notifications = [
    { id: 'n-1', user_id: DONOR_A_USER_ID, channel: 'IN_APP', read_at: null, created_at: '2026-09-18T00:01:00Z' },
    { id: 'n-2', user_id: DONOR_A_USER_ID, channel: 'IN_APP', read_at: '2026-09-18T00:02:00Z', created_at: '2026-09-18T00:02:00Z' },
    { id: 'n-3', user_id: DONOR_A_USER_ID, channel: 'IN_APP', read_at: null, created_at: '2026-09-18T00:03:00Z' }
  ];

  const res = await getUserNotifications({ userId: DONOR_A_USER_ID, page: 1, limit: 2 });
  assert.equal(res.pagination.total, 3);
  assert.equal(res.pagination.unreadCount, 2);
  assert.equal(res.notifications.length, 2);
});

test('getUserNotifications: unreadOnly filter returns only unread in-app alerts', async () => {
  db.notifications = [
    { id: 'n-1', user_id: DONOR_A_USER_ID, channel: 'IN_APP', read_at: null, created_at: '2026-09-18T00:01:00Z' },
    { id: 'n-2', user_id: DONOR_A_USER_ID, channel: 'IN_APP', read_at: '2026-09-18T00:02:00Z', created_at: '2026-09-18T00:02:00Z' }
  ];

  const res = await getUserNotifications({ userId: DONOR_A_USER_ID, unreadOnly: true });
  assert.equal(res.notifications.length, 1);
  assert.equal(res.notifications[0].id, 'n-1');
});

// ==========================================
// 4. Idempotency & Duplicate Prevention
// ==========================================
test('Idempotency: repeated in-app creation for same dispatch returns existing row without duplication', async () => {
  db.notifications = [];
  const notif1 = await createInAppNotification({
    userId: DONOR_A_USER_ID,
    dispatchId: VALID_DISPATCH_ID,
    requestId: VALID_REQUEST_ID,
    title: 'Emergency Blood Need',
    body: 'Urgent donor required'
  });

  const notif2 = await createInAppNotification({
    userId: DONOR_A_USER_ID,
    dispatchId: VALID_DISPATCH_ID,
    requestId: VALID_REQUEST_ID,
    title: 'Emergency Blood Need',
    body: 'Urgent donor required'
  });

  assert.equal(notif1.id, notif2.id);
  const dispatchInAppCount = db.notifications.filter(
    (n) => n.donor_dispatch_id === VALID_DISPATCH_ID && n.channel === 'IN_APP'
  ).length;
  assert.equal(dispatchInAppCount, 1);
});

test('Idempotency: successful email is not resent on repeated notification calls', async () => {
  db.notifications = [];
  let sendCount = 0;
  setEmailSender(async () => {
    sendCount++;
    return { success: true, messageId: 'msg-123' };
  });

  const firstCall = await createEmailNotification({
    userId: DONOR_A_USER_ID,
    toEmail: 'donor.a@test.org',
    dispatchId: VALID_DISPATCH_ID,
    title: 'Emergency Blood Request',
    body: 'Urgent match found'
  });

  assert.equal(firstCall.status, 'SENT');
  assert.equal(sendCount, 1);

  const secondCall = await createEmailNotification({
    userId: DONOR_A_USER_ID,
    toEmail: 'donor.a@test.org',
    dispatchId: VALID_DISPATCH_ID,
    title: 'Emergency Blood Request',
    body: 'Urgent match found'
  });

  assert.equal(secondCall.id, firstCall.id);
  assert.equal(sendCount, 1, 'Email transport must NOT be invoked twice for SENT dispatch');
});

// ==========================================
// 5. Email Failure Decoupling & Retryability
// ==========================================
test('Email Failure: provider failure updates status to FAILED without throwing', async () => {
  db.notifications = [];
  setEmailSender(async () => {
    throw new Error('SMTP connection timed out');
  });

  const failedResult = await createEmailNotification({
    userId: DONOR_A_USER_ID,
    toEmail: 'donor.a@test.org',
    dispatchId: 'disp-failed-1',
    title: 'Emergency Alert',
    body: 'Please respond'
  });

  assert.equal(failedResult.status, 'FAILED');
  assert.ok(failedResult.failed_at);
  assert.equal(failedResult.failure_reason, 'SMTP connection timed out');
});

test('Email Retry: previously FAILED email notification can be retried and succeeds', async () => {
  db.notifications = [
    {
      id: 'notif-failed-retry',
      user_id: DONOR_A_USER_ID,
      donor_dispatch_id: 'disp-failed-retry',
      channel: 'EMAIL',
      status: 'FAILED',
      failed_at: new Date().toISOString(),
      failure_reason: 'Network error',
      title: 'Alert',
      body: 'Body'
    }
  ];

  // Now email provider recovers
  setEmailSender(async () => ({ success: true, messageId: 'recovered-msg-999' }));

  const retried = await createEmailNotification({
    userId: DONOR_A_USER_ID,
    toEmail: 'donor.a@test.org',
    dispatchId: 'disp-failed-retry',
    title: 'Alert',
    body: 'Body'
  });

  assert.equal(retried.id, 'notif-failed-retry');
  assert.equal(retried.status, 'SENT');
  assert.equal(retried.failed_at, null);
  assert.ok(retried.sent_at);
});

// ==========================================
// 6. Batch Dispatch Integration
// ==========================================
test('sendDispatchBatchNotifications: dispatches create both in-app and email notifications', async () => {
  db.notifications = [];
  db.donor_dispatches = [
    { id: 'disp-alpha', donor_id: 'donor-a', status: 'PENDING' },
    { id: 'disp-beta', donor_id: 'donor-b', status: 'PENDING' }
  ];

  let emailRecipients = [];
  setEmailSender(async ({ to }) => {
    emailRecipients.push(to);
    return { success: true, messageId: `msg-${to}` };
  });

  const request = {
    id: VALID_REQUEST_ID,
    blood_group: 'O_POSITIVE',
    resource_type: 'WHOLE_BLOOD',
    urgency: 'CRITICAL'
  };

  const outcome = await sendDispatchBatchNotifications({
    request,
    dispatches: db.donor_dispatches
  });

  assert.equal(outcome.notified, true);
  assert.equal(outcome.total, 2);
  assert.equal(outcome.successfulCount, 2);
  assert.equal(emailRecipients.length, 2);
  assert.ok(emailRecipients.includes('donor.a@test.org'));
  assert.ok(emailRecipients.includes('donor.b@test.org'));

  // Verify in-app notifications exist
  const inAppNotifs = db.notifications.filter((n) => n.channel === 'IN_APP');
  assert.equal(inAppNotifs.length, 2);

  // Verify dispatches marked as NOTIFIED
  assert.equal(db.donor_dispatches[0].status, 'NOTIFIED');
  assert.equal(db.donor_dispatches[1].status, 'NOTIFIED');
});

test('Decoupled Integration: email failure does NOT roll back or cancel valid dispatches', async () => {
  db.notifications = [];
  db.donor_dispatches = [{ id: 'disp-email-fail', donor_id: 'donor-a', status: 'PENDING' }];

  setEmailSender(async () => {
    throw new Error('Resend 500 Service Unavailable');
  });

  const request = { id: VALID_REQUEST_ID, blood_group: 'A_POSITIVE' };
  const outcome = await sendDispatchBatchNotifications({
    request,
    dispatches: db.donor_dispatches
  });

  // In-app succeeded, so overall notified is still true
  assert.equal(outcome.notified, true);
  assert.equal(db.donor_dispatches[0].status, 'NOTIFIED');

  const emailRecord = db.notifications.find((n) => n.channel === 'EMAIL');
  assert.equal(emailRecord.status, 'FAILED');

  const inAppRecord = db.notifications.find((n) => n.channel === 'IN_APP');
  assert.equal(inAppRecord.status, 'DELIVERED');
});

// ==========================================
// 7. Privacy & Anti-Leak Safeguards
// ==========================================
test('Privacy: emergency notification content contains NO patient-sensitive details', () => {
  const request = {
    id: VALID_REQUEST_ID,
    blood_group: 'B_NEGATIVE',
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'HIGH',
    patient_name: 'Jane Doe',
    diagnosis: 'Acute Hemorrhage',
    notes: 'Bed 4 Trauma ICU'
  };

  const { title, body } = formatEmergencyNotificationContent(request);

  // Must include blood group and urgency
  assert.ok(title.includes('B_NEGATIVE'));
  assert.ok(body.includes('B_NEGATIVE'));

  // Must NOT include sensitive clinical/patient identifiers
  assert.equal(title.includes('Jane Doe'), false);
  assert.equal(body.includes('Jane Doe'), false);
  assert.equal(body.includes('Acute Hemorrhage'), false);
  assert.equal(body.includes('Bed 4'), false);
});

// ==========================================
// 8. Audit Logging Verification
// ==========================================
test('Audit Logging: records notification lifecycle events without exposing secrets', async () => {
  db.audit_logs = [];
  setEmailSender(async () => ({ success: true, messageId: 'audit-test-123' }));

  await createEmailNotification({
    userId: DONOR_A_USER_ID,
    toEmail: 'donor.a@test.org',
    dispatchId: 'disp-audit',
    title: 'Alert',
    body: 'Body'
  });

  const sentLogs = db.audit_logs.filter((l) => l.action === 'DONOR_NOTIFICATION_SENT');
  assert.ok(sentLogs.length >= 1);
  const logMetadata = JSON.stringify(sentLogs[0].metadata);
  assert.equal(logMetadata.includes('apiKey'), false);
  assert.equal(logMetadata.includes('secret'), false);
});

// ==========================================
// 9. Edge Cases & Integration Completeness
// ==========================================
test('GET /api/notifications: rejects unprovisioned user with 403', async () => {
  // Setup unprovisioned token
  const origGetUser = supabaseAdmin.auth.getUser;
  supabaseAdmin.auth.getUser = async (t) => {
    if (t === 'token-unprov') return { data: { user: { id: 'unprov-user-999' } }, error: null };
    return origGetUser(t);
  };

  try {
    const { status, body } = await apiRequest('/api/notifications', {}, 'token-unprov');
    assert.equal(status, 403);
    assert.equal(body.error, 'ACCOUNT_NOT_PROVISIONED');
  } finally {
    supabaseAdmin.auth.getUser = origGetUser;
  }
});

test('PATCH /api/notifications/:id/read: returns 404 when notification does not exist', async () => {
  const { status, body } = await apiRequest(
    '/api/notifications/99999999-9999-4000-8000-999999999999/read',
    { method: 'PATCH' },
    'token-donor-a'
  );
  assert.equal(status, 404);
  assert.equal(body.error, 'NOTIFICATION_NOT_FOUND');
});

test('Batch Capping: batch of 5 dispatches creates exactly 5 in-app and 5 email notifications', async () => {
  db.notifications = [];
  const dispatches = Array.from({ length: 5 }, (_, i) => ({
    id: `disp-${i + 1}`,
    donor_id: 'donor-a',
    status: 'PENDING'
  }));

  let emailCount = 0;
  setEmailSender(async () => {
    emailCount++;
    return { success: true, messageId: `msg-${emailCount}` };
  });

  const outcome = await sendDispatchBatchNotifications({
    request: { id: VALID_REQUEST_ID, blood_group: 'O_POSITIVE' },
    dispatches
  });

  assert.equal(outcome.total, 5);
  assert.equal(outcome.successfulCount, 5);
  assert.equal(emailCount, 5);

  const inAppCount = db.notifications.filter((n) => n.channel === 'IN_APP').length;
  assert.equal(inAppCount, 5);
});

test('Non-dispatched donors receive zero notifications', async () => {
  db.notifications = [];
  const outcome = await sendDispatchBatchNotifications({
    request: { id: VALID_REQUEST_ID, blood_group: 'O_POSITIVE' },
    dispatches: []
  });

  assert.equal(outcome.notified, false);
  assert.equal(outcome.total, 0);
  assert.equal(db.notifications.length, 0);
});

test('Database Migration: 20260918_add_donor_notifications.sql includes required schema, RLS, and Realtime', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const sql = fs.readFileSync(path.resolve('db/migrations/20260918_add_donor_notifications.sql'), 'utf8');

  // Verify columns and constraints
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.notifications'));
  assert.ok(sql.includes("channel IN ('IN_APP', 'EMAIL')"));
  assert.ok(sql.includes("status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')"));
  assert.ok(sql.includes('uq_notifications_dispatch_channel'));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('select_own_notifications'));
  assert.ok(sql.includes('update_own_notifications'));
  assert.ok(sql.includes('deny_authenticated_insert_notifications'));
  assert.ok(sql.includes('supabase_realtime'));
});
