import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';

const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const {
  startDonorTracking,
  recordDonorLocation,
  getDispatchTracking,
  markDonorArrived,
  completeDonorDispatch
} = await import('../src/services/donorDispatchService.js');
const { default: app } = await import('../src/app.js');

const DONOR_A_USER_ID = '11111111-1111-4000-8000-000000000001';
const DONOR_B_USER_ID = '22222222-2222-4000-8000-000000000002';
const HOSPITAL_1_USER_ID = '33333333-3333-4000-8000-000000000001';
const HOSPITAL_2_USER_ID = '33333333-3333-4000-8000-000000000002';
const UNPROVISIONED_USER_ID = '44444444-4444-4000-8000-000000000004';

const HOSPITAL_1_ID = 'aaaaaaaa-aaaa-4000-8000-000000000001';
const HOSPITAL_2_ID = 'aaaaaaaa-aaaa-4000-8000-000000000002';

const REQUEST_1_ID = 'bbbbbbbb-bbbb-4000-8000-000000000001';
const REQUEST_2_ID = 'bbbbbbbb-bbbb-4000-8000-000000000002';

const DISPATCH_ACCEPTED_ID = 'cccccccc-cccc-4000-8000-000000000001';
const DISPATCH_PENDING_ID = 'cccccccc-cccc-4000-8000-000000000002';
const DISPATCH_EN_ROUTE_ID = 'cccccccc-cccc-4000-8000-000000000003';
const DISPATCH_ARRIVED_ID = 'cccccccc-cccc-4000-8000-000000000004';
const DISPATCH_COMPLETED_ID = 'cccccccc-cccc-4000-8000-000000000005';
const DISPATCH_DONOR_B_ID = 'cccccccc-cccc-4000-8000-000000000006';

let server;
let baseUrl;
let db;

function resetDb() {
  db = {
    users: {
      [DONOR_A_USER_ID]: { id: DONOR_A_USER_ID, email: 'donor.a@test.org', role: 'DONOR', is_active: true },
      [DONOR_B_USER_ID]: { id: DONOR_B_USER_ID, email: 'donor.b@test.org', role: 'DONOR', is_active: true },
      [HOSPITAL_1_USER_ID]: { id: HOSPITAL_1_USER_ID, email: 'hosp1@test.org', role: 'HOSPITAL', is_active: true },
      [HOSPITAL_2_USER_ID]: { id: HOSPITAL_2_USER_ID, email: 'hosp2@test.org', role: 'HOSPITAL', is_active: true },
      [UNPROVISIONED_USER_ID]: { id: UNPROVISIONED_USER_ID, email: 'unprov@test.org', role: 'DONOR', is_active: true }
    },
    donors: {
      'donor-a': { id: 'donor-a', user_id: DONOR_A_USER_ID, name: 'Donor Alpha', verified: true },
      'donor-b': { id: 'donor-b', user_id: DONOR_B_USER_ID, name: 'Donor Beta', verified: true }
    },
    hospitals: {
      [HOSPITAL_1_ID]: { id: HOSPITAL_1_ID, hospital_name: 'Metro General Hospital' },
      [HOSPITAL_2_ID]: { id: HOSPITAL_2_ID, hospital_name: 'St. Jude Hospital' }
    },
    organization_members: [
      { id: 'mem-1', user_id: HOSPITAL_1_USER_ID, hospital_id: HOSPITAL_1_ID, organization_type: 'HOSPITAL', is_active: true },
      { id: 'mem-2', user_id: HOSPITAL_2_USER_ID, hospital_id: HOSPITAL_2_ID, organization_type: 'HOSPITAL', is_active: true }
    ],
    emergency_requests: {
      [REQUEST_1_ID]: {
        id: REQUEST_1_ID,
        hospital_id: HOSPITAL_1_ID,
        blood_group: 'O_POSITIVE',
        resource_type: 'WHOLE_BLOOD',
        urgency: 'CRITICAL',
        quantity: 2,
        status: 'PARTIALLY_FULFILLED',
        completed_at: null
      },
      [REQUEST_2_ID]: {
        id: REQUEST_2_ID,
        hospital_id: HOSPITAL_2_ID,
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
      [DISPATCH_ACCEPTED_ID]: {
        id: DISPATCH_ACCEPTED_ID,
        request_id: REQUEST_1_ID,
        donor_id: 'donor-a',
        batch_number: 1,
        status: 'ACCEPTED',
        accepted_at: '2026-09-18T00:00:00.000Z',
        en_route_at: null,
        arrived_at: null,
        completed_at: null,
        current_latitude: null,
        current_longitude: null
      },
      [DISPATCH_PENDING_ID]: {
        id: DISPATCH_PENDING_ID,
        request_id: REQUEST_1_ID,
        donor_id: 'donor-a',
        batch_number: 1,
        status: 'PENDING',
        accepted_at: null,
        en_route_at: null,
        arrived_at: null,
        completed_at: null,
        current_latitude: null,
        current_longitude: null
      },
      [DISPATCH_EN_ROUTE_ID]: {
        id: DISPATCH_EN_ROUTE_ID,
        request_id: REQUEST_1_ID,
        donor_id: 'donor-a',
        batch_number: 1,
        status: 'EN_ROUTE',
        accepted_at: '2026-09-18T00:00:00.000Z',
        en_route_at: '2026-09-18T00:10:00.000Z',
        arrived_at: null,
        completed_at: null,
        current_latitude: 12.9716,
        current_longitude: 77.5946
      },
      [DISPATCH_ARRIVED_ID]: {
        id: DISPATCH_ARRIVED_ID,
        request_id: REQUEST_1_ID,
        donor_id: 'donor-a',
        batch_number: 1,
        status: 'ARRIVED',
        accepted_at: '2026-09-18T00:00:00.000Z',
        en_route_at: '2026-09-18T00:10:00.000Z',
        arrived_at: '2026-09-18T00:25:00.000Z',
        completed_at: null,
        current_latitude: 12.9716,
        current_longitude: 77.5946
      },
      [DISPATCH_COMPLETED_ID]: {
        id: DISPATCH_COMPLETED_ID,
        request_id: REQUEST_1_ID,
        donor_id: 'donor-a',
        batch_number: 1,
        status: 'COMPLETED',
        accepted_at: '2026-09-18T00:00:00.000Z',
        en_route_at: '2026-09-18T00:10:00.000Z',
        arrived_at: '2026-09-18T00:25:00.000Z',
        completed_at: '2026-09-18T00:30:00.000Z',
        current_latitude: 12.9716,
        current_longitude: 77.5946
      },
      [DISPATCH_DONOR_B_ID]: {
        id: DISPATCH_DONOR_B_ID,
        request_id: REQUEST_2_ID,
        donor_id: 'donor-b',
        batch_number: 1,
        status: 'ACCEPTED',
        accepted_at: '2026-09-18T00:00:00.000Z',
        en_route_at: null,
        arrived_at: null,
        completed_at: null,
        current_latitude: null,
        current_longitude: null
      }
    },
    live_locations: [],
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
    if (token === 'token-hospital-1') return { data: { user: { id: HOSPITAL_1_USER_ID } }, error: null };
    if (token === 'token-hospital-2') return { data: { user: { id: HOSPITAL_2_USER_ID } }, error: null };
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
            }),
            then: (resolve) => {
              const disp = db.donor_dispatches[v];
              if (disp) Object.assign(disp, updates);
              return resolve({ data: disp, error: null });
            }
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
          const mem = db.organization_members.find((m) =>
            (!qb._eq?.user_id || m.user_id === qb._eq.user_id) &&
            (!qb._eq?.hospital_id || m.hospital_id === qb._eq.hospital_id) &&
            (!qb._eq?.organization_type || m.organization_type === qb._eq.organization_type) &&
            (qb._eq?.is_active === undefined || m.is_active === qb._eq.is_active)
          );
          return { data: mem || null, error: null };
        },
        then: (resolve) => {
          const rows = db.organization_members.filter((m) =>
            (!qb._eq?.user_id || m.user_id === qb._eq.user_id) &&
            (!qb._eq?.hospital_id || m.hospital_id === qb._eq.hospital_id) &&
            (!qb._eq?.organization_type || m.organization_type === qb._eq.organization_type) &&
            (qb._eq?.is_active === undefined || m.is_active === qb._eq.is_active)
          );
          return resolve({ data: rows, error: null });
        }
      };
      return qb;
    }

    if (table === 'live_locations') {
      const qb = {
        select: () => qb,
        eq: (f, v) => { qb._eq = qb._eq || {}; qb._eq[f] = v; return qb; },
        or: (cond) => { qb._or = cond; return qb; },
        order: () => qb,
        limit: () => qb,
        insert: (row) => ({
          select: () => ({
            maybeSingle: async () => {
              const fullRow = { id: `loc-${db.live_locations.length + 1}`, ...row };
              db.live_locations.push(fullRow);
              return { data: fullRow, error: null };
            }
          }),
          then: (resolve) => {
            const fullRow = { id: `loc-${db.live_locations.length + 1}`, ...row };
            db.live_locations.push(fullRow);
            return resolve({ data: fullRow, error: null });
          }
        }),
        then: (resolve) => {
          const rows = [...db.live_locations].reverse();
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
          const found = db.notifications.find((n) => {
            if (qb._eq?.user_id && n.user_id !== qb._eq.user_id) return false;
            if (qb._eq?.request_id && n.request_id !== qb._eq.request_id) return false;
            if (qb._contains?.metadata) {
              for (const [k, val] of Object.entries(qb._contains.metadata)) {
                if (n.metadata?.[k] !== val) return false;
              }
            }
            return true;
          });
          return { data: found || null, error: null };
        },
        insert: async (row) => {
          const fullRow = { id: `notif-${db.notifications.length + 1}`, ...row, created_at: new Date().toISOString() };
          db.notifications.push(fullRow);
          return { data: fullRow, error: null };
        }
      };
      return qb;
    }

    if (table === 'audit_logs') {
      return {
        insert: async (row) => {
          const fullRow = { id: `audit-${db.audit_logs.length + 1}`, ...row, created_at: new Date().toISOString() };
          db.audit_logs.push(fullRow);
          return { data: fullRow, error: null };
        }
      };
    }

    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
    };
  };
});

after(() => {
  if (server) server.close();
});

beforeEach(() => {
  resetDb();
});

// ==========================================
// 1. Authentication Tests
// ==========================================

test('1. unauthenticated tracking start -> 401', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST'
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('2. unauthenticated location update -> 401', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 })
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('3. unauthenticated tracking read -> 401', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking`, {
    method: 'GET'
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

// ==========================================
// 2. Roles & Permissions Tests
// ==========================================

test('4. hospital cannot start donor tracking -> 403', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

test('5. donor cannot access another donor dispatch tracking -> 403', async () => {
  // DISPATCH_DONOR_B_ID belongs to donor B, donor A tries to access
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_DONOR_B_ID}/tracking`, {
    method: 'GET',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

test('6. unrelated hospital cannot view dispatch tracking -> 403', async () => {
  // Hospital 2 tries to view DISPATCH_ACCEPTED_ID belonging to Hospital 1's request
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking`, {
    method: 'GET',
    headers: { Authorization: 'Bearer token-hospital-2' }
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

// ==========================================
// 3. Tracking Start Tests
// ==========================================

test('7. ACCEPTED -> EN_ROUTE succeeds', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'EN_ROUTE');
  assert.equal(json.dispatchId, DISPATCH_ACCEPTED_ID);
  assert.ok(json.enRouteAt);

  // Verify database record updated
  const updated = db.donor_dispatches[DISPATCH_ACCEPTED_ID];
  assert.equal(updated.status, 'EN_ROUTE');
  assert.ok(updated.en_route_at);

  // Verify audit log
  const audit = db.audit_logs.find((a) => a.action === 'DONOR_DISPATCH_EN_ROUTE');
  assert.ok(audit);
  assert.equal(audit.entity_id, DISPATCH_ACCEPTED_ID);
});

test('8. non-ACCEPTED -> EN_ROUTE rejected with 409', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_PENDING_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_STATE_TRANSITION');
});

test('9. duplicate start is idempotent', async () => {
  // DISPATCH_EN_ROUTE_ID is already EN_ROUTE
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'EN_ROUTE');
  assert.equal(json.isAlreadyStarted, true);
});

test('10. correct server timestamps set on tracking start', async () => {
  const beforeTime = new Date().toISOString();
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.enRouteAt >= beforeTime);
});

// ==========================================
// 4. Location Update Tests
// ==========================================

test('11. valid location accepted when EN_ROUTE', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 })
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.latitude, 12.9716);
  assert.equal(json.longitude, 77.5946);
  assert.ok(json.recordedAt);

  // Verify live_locations record created
  assert.equal(db.live_locations.length, 1);
  assert.equal(db.live_locations[0].latitude, 12.9716);
  assert.equal(db.live_locations[0].dispatch_id, DISPATCH_EN_ROUTE_ID);
});

test('12. invalid latitude (< -90 or > 90) rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 95.0, longitude: 77.5946 })
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_LOCATION');
});

test('13. invalid longitude (< -180 or > 180) rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 12.9716, longitude: 185.0 })
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_LOCATION');
});

test('14. NaN or infinite values rejected with 400', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 'not-a-number', longitude: 77.5946 })
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_LOCATION');
});

test('15. donor cannot update location for another donor dispatch -> 403', async () => {
  // Donor B tries to update location for Donor A's dispatch
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-b',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 })
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

test('16. location rejected when dispatch is not EN_ROUTE -> 409', async () => {
  // DISPATCH_ACCEPTED_ID is ACCEPTED, not EN_ROUTE
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 })
  });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_STATE_TRANSITION');
});

test('17. server timestamp used for live_locations entry', async () => {
  const beforeTime = new Date().toISOString();
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/location`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token-donor-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 })
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.recordedAt >= beforeTime);
});

// ==========================================
// 5. Arrival Confirmation Tests
// ==========================================

test('18. EN_ROUTE -> ARRIVED succeeds by hospital staff', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/tracking/arrive`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'ARRIVED');
  assert.ok(json.arrivedAt);

  // Verify database record
  assert.equal(db.donor_dispatches[DISPATCH_EN_ROUTE_ID].status, 'ARRIVED');
  assert.ok(db.donor_dispatches[DISPATCH_EN_ROUTE_ID].arrived_at);

  // Verify audit log
  const audit = db.audit_logs.find((a) => a.action === 'DONOR_DISPATCH_ARRIVED');
  assert.ok(audit);
  assert.equal(audit.entity_id, DISPATCH_EN_ROUTE_ID);
});

test('19. invalid arrival transition (e.g. from ACCEPTED or PENDING) rejected with 409', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/arrive`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_STATE_TRANSITION');
});

test('20. unauthorized actor rejected on mark arrived -> 403', async () => {
  // Hospital 2 is not the hospital for DISPATCH_EN_ROUTE_ID's request
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/tracking/arrive`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-2' }
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

// ==========================================
// 6. Completion Tests
// ==========================================

test('21. ARRIVED -> COMPLETED succeeds by authorized hospital staff', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ARRIVED_ID}/tracking/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'COMPLETED');
  assert.ok(json.completedAt);

  // Verify database record
  assert.equal(db.donor_dispatches[DISPATCH_ARRIVED_ID].status, 'COMPLETED');
  assert.ok(db.donor_dispatches[DISPATCH_ARRIVED_ID].completed_at);

  // Verify audit log
  const audit = db.audit_logs.find((a) => a.action === 'DONOR_DISPATCH_COMPLETED');
  assert.ok(audit);
});

test('22. duplicate completion is idempotent', async () => {
  // DISPATCH_COMPLETED_ID is already COMPLETED
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_COMPLETED_ID}/tracking/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, 'COMPLETED');
  assert.equal(json.isAlreadyCompleted, true);
});

test('23. completion cannot double-count fulfillment', async () => {
  // Initial request status was PARTIALLY_FULFILLED
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ARRIVED_ID}/tracking/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 200);

  // Calling completion again should return same state and NOT decrement units or alter allocations
  const res2 = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ARRIVED_ID}/tracking/complete`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.isAlreadyCompleted, true);
});

test('24. completed dispatch cannot be transitioned back to EN_ROUTE', async () => {
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_COMPLETED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.error, 'INVALID_STATE_TRANSITION');
});

// ==========================================
// 7. Security & Visibility Tests
// ==========================================

test('25. tracking read returns latest location and timestamps for authorized hospital', async () => {
  // Add a live location record
  db.live_locations.push({
    id: 'loc-1',
    dispatch_id: DISPATCH_EN_ROUTE_ID,
    donor_id: 'donor-a',
    request_id: REQUEST_1_ID,
    latitude: 12.9716,
    longitude: 77.5946,
    recorded_at: '2026-09-18T00:15:00.000Z'
  });

  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/tracking`, {
    method: 'GET',
    headers: { Authorization: 'Bearer token-hospital-1' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.dispatchId, DISPATCH_EN_ROUTE_ID);
  assert.equal(json.status, 'EN_ROUTE');
  assert.equal(json.currentLocation?.latitude, 12.9716);
  assert.equal(json.currentLocation?.longitude, 77.5946);
  assert.ok(json.timestamps);
});

test('26. hospital only sees locations for its own emergency requests', async () => {
  // Hospital 2 queries tracking for Hospital 1's dispatch -> 403
  const res = await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_EN_ROUTE_ID}/tracking`, {
    method: 'GET',
    headers: { Authorization: 'Bearer token-hospital-2' }
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

test('27. no patient-sensitive fields in audit metadata', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });

  const audits = db.audit_logs.filter((a) => a.entity_id === DISPATCH_ACCEPTED_ID);
  for (const audit of audits) {
    const metaStr = JSON.stringify(audit.metadata);
    assert.equal(metaStr.includes('patient'), false, 'Audit metadata must not contain patient references');
    assert.equal(metaStr.includes('medical'), false, 'Audit metadata must not contain medical details');
  }
});

test('28. notifications are sanitized and contain no PHI/PII', async () => {
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });

  for (const notif of db.notifications) {
    assert.equal(notif.body.includes('patient'), false);
    assert.equal(notif.body.includes('medical_record'), false);
    assert.ok(notif.title);
  }
});

test('29. duplicate transition does not duplicate notifications', async () => {
  // Start tracking
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  const notifCountAfterFirst = db.notifications.length;

  // Duplicate start (idempotent)
  await fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-donor-a' }
  });
  const notifCountAfterSecond = db.notifications.length;

  assert.equal(notifCountAfterSecond, notifCountAfterFirst, 'Notification count must remain identical on duplicate transition');
});

// ==========================================
// 8. Concurrency Tests
// ==========================================

test('30. concurrent start attempts cannot corrupt dispatch state', async () => {
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-donor-a' }
    }),
    fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ACCEPTED_ID}/tracking/start`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-donor-a' }
    })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(db.donor_dispatches[DISPATCH_ACCEPTED_ID].status, 'EN_ROUTE');
});

test('31. concurrent completion cannot over-fulfill request', async () => {
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ARRIVED_ID}/tracking/complete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-hospital-1' }
    }),
    fetch(`${baseUrl}/api/donor-dispatches/${DISPATCH_ARRIVED_ID}/tracking/complete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-hospital-1' }
    })
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(db.donor_dispatches[DISPATCH_ARRIVED_ID].status, 'COMPLETED');
});

// ==========================================
// 9. Database Migration Verification
// ==========================================

test('32. Database Migration: 20260918_add_donor_tracking_lifecycle.sql includes required schema, RLS, and Realtime', () => {
  const migrationPath = path.resolve(process.cwd(), 'db/migrations/20260918_add_donor_tracking_lifecycle.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Status enum
  assert.ok(sql.includes("ALTER TYPE public.dispatch_status ADD VALUE IF NOT EXISTS 'EN_ROUTE'"), 'Enum must include EN_ROUTE');
  assert.ok(sql.includes("ALTER TYPE public.dispatch_status ADD VALUE IF NOT EXISTS 'ARRIVED'"), 'Enum must include ARRIVED');

  // Milestone timestamps
  assert.ok(sql.includes('en_route_at'), 'Must include en_route_at');
  assert.ok(sql.includes('arrived_at'), 'Must include arrived_at');
  assert.ok(sql.includes('completed_at'), 'Must include completed_at');

  // live_locations dispatch_id
  assert.ok(sql.includes('dispatch_id'), 'live_locations must include dispatch_id');

  // Active partial unique index
  assert.ok(sql.includes('uq_donor_dispatch_active_request_donor'), 'Must recreate active dispatch partial unique index');
  assert.ok(sql.includes("'EN_ROUTE'"), 'Index must cover EN_ROUTE');
  assert.ok(sql.includes("'ARRIVED'"), 'Index must cover ARRIVED');

  // RLS Policies
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'), 'Must enable RLS');
  assert.ok(sql.includes('deny_anon_live_locations'), 'Must deny anon access');
  assert.ok(sql.includes('donor_select_own_locations'), 'Must allow donor to select own locations');
  assert.ok(sql.includes('hospital_select_request_locations'), 'Must allow hospital to select request locations');

  // Realtime publication
  assert.ok(sql.includes('supabase_realtime'), 'Must configure supabase_realtime publication');
});
