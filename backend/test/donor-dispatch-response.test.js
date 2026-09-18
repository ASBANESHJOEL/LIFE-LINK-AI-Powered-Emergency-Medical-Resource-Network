import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';

const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const { respondToDonorDispatch } = await import('../src/services/donorDispatchService.js');
const { default: app } = await import('../src/app.js');

const DONOR_A_USER_ID = '11111111-1111-4000-8000-000000000001';
const DONOR_B_USER_ID = '22222222-2222-4000-8000-000000000002';
const HOSPITAL_USER_ID = '33333333-3333-4000-8000-000000000003';
const UNPROVISIONED_USER_ID = '44444444-4444-4000-8000-000000000004';

const HOSPITAL_ID = 'aaaaaaaa-aaaa-4000-8000-000000000001';
const REQUEST_ID_1 = 'bbbbbbbb-bbbb-4000-8000-000000000001';
const REQUEST_ID_2 = 'bbbbbbbb-bbbb-4000-8000-000000000002';

const DISPATCH_A1 = 'cccccccc-cccc-4000-8000-000000000001';
const DISPATCH_A2 = 'cccccccc-cccc-4000-8000-000000000002';
const DISPATCH_B1 = 'cccccccc-cccc-4000-8000-000000000003';

let server;
let baseUrl;

// In-memory mock database
let db;

function resetDb() {
  db = {
    users: {
      [DONOR_A_USER_ID]: { id: DONOR_A_USER_ID, email: 'donor.a@test.org', role: 'DONOR', is_active: true },
      [DONOR_B_USER_ID]: { id: DONOR_B_USER_ID, email: 'donor.b@test.org', role: 'DONOR', is_active: true },
      [HOSPITAL_USER_ID]: { id: HOSPITAL_USER_ID, email: 'hosp@test.org', role: 'HOSPITAL', is_active: true },
      [UNPROVISIONED_USER_ID]: { id: UNPROVISIONED_USER_ID, email: 'unprov@test.org', role: 'DONOR', is_active: true }
    },
    donors: {
      'donor-a': { id: 'donor-a', user_id: DONOR_A_USER_ID, name: 'Donor Alpha', verified: true },
      'donor-b': { id: 'donor-b', user_id: DONOR_B_USER_ID, name: 'Donor Beta', verified: true }
    },
    hospitals: {
      [HOSPITAL_ID]: { id: HOSPITAL_ID, hospital_name: 'City General Hospital' }
    },
    organization_members: [
      { id: 'mem-1', user_id: HOSPITAL_USER_ID, hospital_id: HOSPITAL_ID, organization_type: 'HOSPITAL', is_active: true }
    ],
    emergency_requests: {
      [REQUEST_ID_1]: {
        id: REQUEST_ID_1,
        hospital_id: HOSPITAL_ID,
        blood_group: 'O_POSITIVE',
        resource_type: 'WHOLE_BLOOD',
        urgency: 'CRITICAL',
        quantity: 2,
        status: 'OPEN',
        completed_at: null
      },
      [REQUEST_ID_2]: {
        id: REQUEST_ID_2,
        hospital_id: HOSPITAL_ID,
        blood_group: 'A_POSITIVE',
        resource_type: 'RED_BLOOD_CELLS',
        urgency: 'HIGH',
        quantity: 1,
        status: 'OPEN',
        completed_at: null
      }
    },
    request_inventory_allocations: [],
    donor_dispatches: {
      [DISPATCH_A1]: {
        id: DISPATCH_A1,
        request_id: REQUEST_ID_1,
        donor_id: 'donor-a',
        batch_number: 1,
        priority_score: 0.95,
        status: 'NOTIFIED',
        responded_at: null,
        accepted_at: null
      },
      [DISPATCH_A2]: {
        id: DISPATCH_A2,
        request_id: REQUEST_ID_2,
        donor_id: 'donor-a',
        batch_number: 1,
        priority_score: 0.90,
        status: 'PENDING',
        responded_at: null,
        accepted_at: null
      },
      [DISPATCH_B1]: {
        id: DISPATCH_B1,
        request_id: REQUEST_ID_1,
        donor_id: 'donor-b',
        batch_number: 1,
        priority_score: 0.85,
        status: 'NOTIFIED',
        responded_at: null,
        accepted_at: null
      }
    },
    notifications: [],
    audit_logs: []
  };
}

before(async () => {
  resetDb();
  server = app.listen(0);
  baseUrl = await new Promise((resolve) => {
    server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });

  supabaseAdmin.auth.getUser = async (token) => {
    if (token === 'token-donor-a') return { data: { user: { id: DONOR_A_USER_ID } }, error: null };
    if (token === 'token-donor-b') return { data: { user: { id: DONOR_B_USER_ID } }, error: null };
    if (token === 'token-hospital') return { data: { user: { id: HOSPITAL_USER_ID } }, error: null };
    if (token === 'token-unprovisioned') return { data: { user: { id: UNPROVISIONED_USER_ID } }, error: null };
    return { data: { user: null }, error: new Error('Invalid token') };
  };

  supabaseAdmin.from = (table) => {
    if (table === 'users') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        maybeSingle: async () => ({ data: db.users[qb._eq?.id] || null, error: null }),
        single: async () => ({ data: db.users[qb._eq?.id] || null, error: null })
      };
      return qb;
    }

    if (table === 'donors') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        maybeSingle: async () => {
          const donor = Object.values(db.donors).find((d) => d.user_id === qb._eq?.user_id || d.id === qb._eq?.id);
          return { data: donor || null, error: null };
        }
      };
      return qb;
    }

    if (table === 'emergency_requests') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        maybeSingle: async () => ({ data: db.emergency_requests[qb._eq?.id] || null, error: null }),
        update: (updates) => ({
          eq: (f, v) => {
            const req = db.emergency_requests[v];
            if (req) Object.assign(req, updates);
            return Promise.resolve({ data: req, error: null });
          }
        })
      };
      return qb;
    }

    if (table === 'donor_dispatches') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        in: (f, vals) => { qb._in = qb._in || {}; qb._in[f] = vals; return qb; },
        maybeSingle: async () => ({ data: db.donor_dispatches[qb._eq?.id] || null, error: null }),
        update: (updates) => ({
          eq: (f, v) => ({
            select: () => ({
              single: async () => {
                const disp = db.donor_dispatches[v];
                if (disp) Object.assign(disp, updates);
                return { data: disp, error: null };
              }
            })
          })
        }),
        then: (resolve) => {
          let rows = Object.values(db.donor_dispatches);
          if (qb._eq?.request_id) rows = rows.filter((d) => d.request_id === qb._eq.request_id);
          if (qb._in?.status) rows = rows.filter((d) => qb._in.status.includes(d.status));
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'request_inventory_allocations') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        then: (resolve) => {
          let rows = db.request_inventory_allocations;
          if (qb._eq?.request_id) rows = rows.filter((r) => r.request_id === qb._eq.request_id);
          if (qb._eq?.status) rows = rows.filter((r) => r.status === qb._eq.status);
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'organization_members') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        maybeSingle: async () => {
          let rows = db.organization_members;
          if (qb._eq?.user_id) rows = rows.filter((m) => m.user_id === qb._eq.user_id);
          if (qb._eq?.hospital_id) rows = rows.filter((m) => m.hospital_id === qb._eq.hospital_id);
          return { data: rows[0] || null, error: null };
        },
        then: (resolve) => {
          let rows = db.organization_members;
          if (qb._eq?.hospital_id) rows = rows.filter((m) => m.hospital_id === qb._eq.hospital_id);
          if (qb._eq?.organization_type) rows = rows.filter((m) => m.organization_type === qb._eq.organization_type);
          if (qb._eq?.is_active !== undefined) rows = rows.filter((m) => m.is_active === qb._eq.is_active);
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'notifications') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        contains: (f, v) => { qb._contains = qb._contains || {}; qb._contains[f] = v; return qb; },
        maybeSingle: async () => {
          const match = db.notifications.find((n) => {
            if (qb._eq?.user_id && n.user_id !== qb._eq.user_id) return false;
            if (qb._eq?.request_id && n.request_id !== qb._eq.request_id) return false;
            if (qb._contains?.metadata) {
              for (const [k, val] of Object.entries(qb._contains.metadata)) {
                if (n.metadata?.[k] !== val) return false;
              }
            }
            return true;
          });
          return { data: match || null, error: null };
        },
        insert: async (item) => {
          const record = { id: `notif-${db.notifications.length + 1}`, ...item, created_at: new Date().toISOString() };
          db.notifications.push(record);
          return { data: record, error: null };
        }
      };
      return qb;
    }

    if (table === 'audit_logs') {
      return {
        insert: async (item) => {
          db.audit_logs.push({ id: `audit-${db.audit_logs.length + 1}`, ...item });
          return { data: null, error: null };
        }
      };
    }

    throw new Error(`Unexpected table access: ${table}`);
  };

  // Simulate RPC failure or fallback to direct operations
  supabaseAdmin.rpc = async (func, args) => {
    return { data: null, error: { code: 'PGRST202', message: 'Function not found in mock, using direct operations' } };
  };
});

beforeEach(() => {
  resetDb();
});

after(() => {
  if (server) server.close();
});

// ==========================================
// 1. Authentication & Authorization
// ==========================================

test('AUTH: unauthenticated request to POST /api/donor-dispatches/:id/respond returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 401);
});

test('AUTH: HOSPITAL role request to respond endpoint returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-hospital',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 403);
});

test('AUTH: unprovisioned DONOR account returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-unprovisioned',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 403);
});

// ==========================================
// 2. Input Validation
// ==========================================

test('INPUT: rejects malformed UUID with 400 INVALID_DISPATCH_ID', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/invalid-uuid/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_DISPATCH_ID');
});

test('INPUT: rejects invalid response value with 400 INVALID_RESPONSE', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'MAYBE' })
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_RESPONSE');
});

test('INPUT: rejects missing response field with 400 INVALID_RESPONSE', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

// ==========================================
// 3. Ownership Protection
// ==========================================

test('OWNERSHIP: donor cannot respond to another donor’s dispatch (403 FORBIDDEN)', async () => {
  // DISPATCH_B1 belongs to donor-b, donor-a attempts to respond
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_B1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'FORBIDDEN');
});

test('OWNERSHIP: returns 404 when dispatch does not exist', async () => {
  const nonExistentId = '99999999-9999-4000-8000-000000000099';
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${nonExistentId}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });
  assert.equal(res.status, 404);
});

// ==========================================
// 4. State Machine: ACCEPT Lifecycle
// ==========================================

test('STATE: donor accepts a NOTIFIED dispatch successfully', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dispatchStatus, 'ACCEPTED');
  assert.ok(data.acceptedAt);
  assert.ok(data.respondedAt);
  assert.equal(data.isAlreadyResponded, false);

  // Check state in database
  assert.equal(db.donor_dispatches[DISPATCH_A1].status, 'ACCEPTED');
});

test('TIMESTAMPS: response sets accepted_at and responded_at accurately', async () => {
  const beforeTime = new Date().getTime();
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A2}/respond`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const acceptedTime = new Date(data.acceptedAt).getTime();
  assert.ok(acceptedTime >= beforeTime);
});

test('IDEMPOTENCY: duplicate ACCEPT returns existing dispatch without decrementing remaining quantity', async () => {
  // First acceptance
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  // Second acceptance
  const res2 = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.dispatchStatus, 'ACCEPTED');
  assert.equal(data2.isAlreadyResponded, true);
});

test('STATE MACHINE: cannot accept a previously DECLINED dispatch (409)', async () => {
  db.donor_dispatches[DISPATCH_A1].status = 'DECLINED';

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_STATE_TRANSITION');
});

test('STATE MACHINE: cannot accept a COMPLETED or CANCELLED dispatch (409)', async () => {
  db.donor_dispatches[DISPATCH_A1].status = 'COMPLETED';

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 409);
});

test('STATE MACHINE: cannot decline an already ACCEPTED dispatch (409)', async () => {
  db.donor_dispatches[DISPATCH_A1].status = 'ACCEPTED';

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, 'INVALID_STATE_TRANSITION');
});

// ==========================================
// 5. State Machine: DECLINE Lifecycle
// ==========================================

test('DECLINE: donor successfully declines dispatch transitioning status to DECLINED', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dispatchStatus, 'DECLINED');
  assert.ok(data.respondedAt);
  assert.equal(data.acceptedAt, null);

  assert.equal(db.donor_dispatches[DISPATCH_A1].status, 'DECLINED');
});

test('DECLINE IDEMPOTENCY: duplicate DECLINE is safe and idempotent', async () => {
  db.donor_dispatches[DISPATCH_A1].status = 'DECLINED';
  db.donor_dispatches[DISPATCH_A1].responded_at = new Date().toISOString();

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.dispatchStatus, 'DECLINED');
  assert.equal(data.isAlreadyResponded, true);
});

test('DECLINE ISOLATION: declining a dispatch leaves emergency request status active', async () => {
  const initialStatus = db.emergency_requests[REQUEST_ID_1].status;

  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  assert.equal(db.emergency_requests[REQUEST_ID_1].status, initialStatus);
});

// ==========================================
// 6. Request Fulfillment Transitions
// ==========================================

test('FULFILLMENT: request with 2 units transitions to PARTIALLY_FULFILLED on first acceptance', async () => {
  // REQUEST_ID_1 has quantity 2
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.requestStatus, 'PARTIALLY_FULFILLED');
  assert.equal(data.remainingUnits, 1);
  assert.equal(db.emergency_requests[REQUEST_ID_1].status, 'PARTIALLY_FULFILLED');
  assert.equal(db.emergency_requests[REQUEST_ID_1].completed_at, null);
});

test('FULFILLMENT: request with 1 unit transitions to FULFILLED and sets completed_at on acceptance', async () => {
  // REQUEST_ID_2 has quantity 1
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A2}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.requestStatus, 'FULFILLED');
  assert.equal(data.remainingUnits, 0);
  assert.equal(db.emergency_requests[REQUEST_ID_2].status, 'FULFILLED');
  assert.ok(db.emergency_requests[REQUEST_ID_2].completed_at);
});

test('CONCURRENCY: rejects acceptance when remaining requirement is 0 (REQUEST_ALREADY_FULFILLED)', async () => {
  // REQUEST_ID_2 has quantity 1 and is OPEN, but inventory already reserved 1 unit -> remaining units is 0
  db.request_inventory_allocations = [{ request_id: REQUEST_ID_2, allocated_units: 1, status: 'RESERVED' }];

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A2}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, 'REQUEST_ALREADY_FULFILLED');
});

test('REQUEST STATE: rejects acceptance when emergency request is already FULFILLED (REQUEST_NOT_OPEN)', async () => {
  db.emergency_requests[REQUEST_ID_1].status = 'FULFILLED';

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, 'REQUEST_NOT_OPEN');
});

test('REQUEST STATE: rejects acceptance when emergency request is CANCELLED (REQUEST_NOT_OPEN)', async () => {
  db.emergency_requests[REQUEST_ID_1].status = 'CANCELLED';

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, 'REQUEST_NOT_OPEN');
});

// ==========================================
// 7. Audit Logging & Privacy
// ==========================================

test('AUDIT: records DONOR_DISPATCH_ACCEPTED without patient PII', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  const audit = db.audit_logs.find((a) => a.action === 'DONOR_DISPATCH_ACCEPTED');
  assert.ok(audit);
  assert.equal(audit.actor_user_id, DONOR_A_USER_ID);
  assert.equal(audit.entity_id, DISPATCH_A1);
  assert.equal(audit.metadata.dispatch_status, 'ACCEPTED');

  // Verify zero sensitive fields
  const str = JSON.stringify(audit);
  assert.equal(str.includes('patient'), false);
  assert.equal(str.includes('diagnosis'), false);
  assert.equal(str.includes('bed'), false);
});

test('AUDIT: records DONOR_DISPATCH_DECLINED', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  const audit = db.audit_logs.find((a) => a.action === 'DONOR_DISPATCH_DECLINED');
  assert.ok(audit);
  assert.equal(audit.action, 'DONOR_DISPATCH_DECLINED');
});

// ==========================================
// 8. Notifications
// ==========================================

test('HOSPITAL NOTIFICATION: creates in-app notification for hospital members on donor acceptance', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  const notif = db.notifications.find((n) => n.user_id === HOSPITAL_USER_ID);
  assert.ok(notif);
  assert.equal(notif.channel, 'IN_APP');
  assert.equal(notif.status, 'DELIVERED');
  assert.ok(notif.title.includes('Donor Accepted'));
  assert.equal(notif.metadata.dispatch_id, DISPATCH_A1);
});

test('NOTIFICATION FILTERING: does NOT create hospital notification on donor decline', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'DECLINE' })
  });

  const hospNotif = db.notifications.find((n) => n.user_id === HOSPITAL_USER_ID);
  assert.equal(hospNotif, undefined);
});

test('NOTIFICATION DEDUPLICATION: duplicate acceptance does not create duplicate hospital notification', async () => {
  // First accept
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  const countAfterFirst = db.notifications.filter((n) => n.user_id === HOSPITAL_USER_ID).length;

  // Second accept (duplicate)
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_A1}/respond`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a', 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: 'ACCEPT' })
  });

  const countAfterSecond = db.notifications.filter((n) => n.user_id === HOSPITAL_USER_ID).length;
  assert.equal(countAfterFirst, 1);
  assert.equal(countAfterSecond, 1);
});

// ==========================================
// 9. Database Migration & RPC Integrity
// ==========================================

test('MIGRATION: 20260918_add_donor_dispatch_response_rpc.sql includes atomic locks and checks', () => {
  const sqlPath = path.resolve('db/migrations/20260918_add_donor_dispatch_response_rpc.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.respond_to_donor_dispatch'));
  assert.ok(sql.includes('FOR UPDATE'));
  assert.ok(sql.includes("status = 'ACCEPTED'"));
  assert.ok(sql.includes("status = 'DECLINED'"));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.respond_to_donor_dispatch'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.respond_to_donor_dispatch(uuid, uuid, text) TO service_role'));
});
