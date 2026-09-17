import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { supabaseAdmin } from '../src/lib/supabaseAdmin.js';
import { createNextDonorDispatchBatch } from '../src/services/donorDispatchService.js';

const VALID_REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const VALID_HOSPITAL_ID = '11111111-1111-4000-8000-111111111111';
const OTHER_HOSPITAL_ID = '22222222-2222-4000-8000-222222222222';
const VALID_ACTOR_USER_ID = '33333333-3333-4000-8000-333333333333';

// Set dummy ML_API_URL so donorRankingService doesn't throw ML_NOT_CONFIGURED unless intended
process.env.ML_API_URL = 'http://ml.test.local';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => server.close());

// Save original methods for cleanup
const originalGetUser = supabaseAdmin.auth.getUser;
const originalFrom = supabaseAdmin.from;
const originalFetch = globalThis.fetch;

after(() => {
  supabaseAdmin.auth.getUser = originalGetUser;
  supabaseAdmin.from = originalFrom;
  globalThis.fetch = originalFetch;
});

async function apiPost(path, body = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

// Helper to create a valid emergency request
function createTestRequest(overrides = {}) {
  return {
    id: VALID_REQUEST_ID,
    hospital_id: VALID_HOSPITAL_ID,
    blood_group: 'O_POSITIVE',
    quantity: 2,
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    status: 'OPEN',
    ...overrides
  };
}

// Helper to create mock donors
function createTestDonors(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: `donor-uuid-${i + 1}`,
    user_id: `user-uuid-${i + 1}`,
    name: `Donor ${i + 1}`,
    blood_group: 'O_POSITIVE',
    availability_status: 'AVAILABLE',
    eligibility_status: 'ELIGIBLE',
    last_donation_date: '2025-01-01',
    live_location_enabled: true,
    verified: true,
    current_latitude: 12.97,
    current_longitude: 77.59
  }));
}

// Configurable DB mock state
let dbMock = {};

function resetDbMock() {
  dbMock = {
    users: {},
    organization_members: {},
    emergency_requests: {},
    defaultEmergencyRequest: createTestRequest(),
    request_inventory_allocations: [],
    donors: [],
    donor_dispatches: [],
    audit_logs: [],
    latestBatchNumber: 0,
    activeDispatches: [],
    alreadyDispatchedInEligibility: [],
    auditInsertError: null,
    dispatchInsertError: null,
    emergencyRequestLookupError: null,
    deletedDispatches: []
  };
}

beforeEach(() => {
  resetDbMock();

  // Mock Supabase Auth
  supabaseAdmin.auth.getUser = async (token) => {
    if (token === 'hospital-token') {
      return { data: { user: { id: VALID_ACTOR_USER_ID, email: 'hosp@test.org' } }, error: null };
    }
    if (token === 'donor-token') {
      return { data: { user: { id: 'donor-user-id', email: 'donor@test.org' } }, error: null };
    }
    if (token === 'blood-bank-token') {
      return { data: { user: { id: 'bb-user-id', email: 'bb@test.org' } }, error: null };
    }
    if (token === 'admin-token') {
      return { data: { user: { id: 'admin-user-id', email: 'admin@test.org' } }, error: null };
    }
    if (token === 'unprovisioned-token') {
      return { data: { user: { id: 'unprov-user-id', email: 'unprov@test.org' } }, error: null };
    }
    return { data: { user: null }, error: new Error('Invalid token') };
  };

  // Mock Supabase DB query builder
  supabaseAdmin.from = (table) => {
    const filters = [];
    let isSingle = false;
    let isDelete = false;
    let limitCount = null;
    let insertedRows = null;

    let selectedColumns = '*';

    const queryBuilder = {
      select(cols = '*') {
        selectedColumns = cols;
        return this;
      },
      eq(column, value) {
        filters.push({ column, value, type: 'eq' });
        return this;
      },
      neq(column, value) {
        filters.push({ column, value, type: 'neq' });
        return this;
      },
      in(column, values) {
        filters.push({ column, values, type: 'in' });
        return this;
      },
      order() { return this; },
      limit(n) {
        limitCount = n;
        return this;
      },
      delete() {
        isDelete = true;
        return this;
      },
      update(updates) {
        return this;
      },
      maybeSingle() {
        isSingle = true;
        return this.execute();
      },
      insert(rows) {
        insertedRows = Array.isArray(rows) ? rows : [rows];
        return {
          select: () => queryBuilder,
          then: (resolve, reject) => queryBuilder.execute().then(resolve, reject)
        };
      },
      then(resolve, reject) {
        return this.execute().then(resolve, reject);
      },
      async execute() {
        if (table === 'users') {
          const idFilter = filters.find((f) => f.column === 'id');
          const userId = idFilter?.value;
          let role = 'HOSPITAL';
          if (userId === 'donor-user-id') role = 'DONOR';
          else if (userId === 'bb-user-id') role = 'BLOOD_BANK';
          else if (userId === 'admin-user-id') role = 'ADMIN';

          return {
            data: { id: userId, email: 'user@test.org', role, is_active: true },
            error: null
          };
        }

        if (table === 'organization_members') {
          const userFilter = filters.find((f) => f.column === 'user_id');
          if (userFilter?.value === 'unprov-user-id') {
            return { data: null, error: null };
          }
          return {
            data: {
              id: 'membership-1',
              organization_type: 'HOSPITAL',
              hospital_id: VALID_HOSPITAL_ID,
              hospitals: { id: VALID_HOSPITAL_ID, hospital_name: 'City Care Hospital' }
            },
            error: null
          };
        }

        if (table === 'emergency_requests') {
          if (dbMock.emergencyRequestLookupError) {
            return { data: null, error: dbMock.emergencyRequestLookupError };
          }
          const idFilter = filters.find((f) => f.column === 'id');
          const req = dbMock.emergency_requests[idFilter?.value] !== undefined
            ? dbMock.emergency_requests[idFilter?.value]
            : dbMock.defaultEmergencyRequest;
          return { data: req || null, error: null };
        }

        if (table === 'request_inventory_allocations') {
          return { data: dbMock.request_inventory_allocations || [], error: null };
        }

        if (table === 'notifications') {
          return { data: [], error: null };
        }

        if (table === 'donors') {
          let donors = dbMock.donors || [];
          if (limitCount) donors = donors.slice(0, limitCount);
          return { data: donors, error: null };
        }

        if (table === 'donor_dispatches') {
          if (isDelete) {
            const inFilter = filters.find((f) => f.column === 'id');
            dbMock.deletedDispatches.push(...(inFilter?.values || []));
            dbMock.donor_dispatches = dbMock.donor_dispatches.filter(
              (d) => !(inFilter?.values || []).includes(d.id)
            );
            return { data: null, error: null };
          }

          if (dbMock.dispatchInsertError && insertedRows) {
            return { data: null, error: dbMock.dispatchInsertError };
          }
          if (insertedRows) {
            const created = insertedRows.map((r, i) => ({
              id: `disp-${Date.now()}-${i}`,
              ...r,
              eta: null,
              notified_at: null,
              responded_at: null,
              accepted_at: null,
              created_at: new Date().toISOString()
            }));
            dbMock.donor_dispatches.push(...created);
            return { data: created, error: null };
          }

          // Check if this is getNextBatchNumber query
          const isBatchQuery = isSingle && filters.some((f) => f.column === 'request_id');
          if (isBatchQuery) {
            return {
              data: dbMock.latestBatchNumber > 0 ? { batch_number: dbMock.latestBatchNumber } : null,
              error: null
            };
          }

          // Check if this is active dispatch check
          const inFilter = filters.find((f) => f.column === 'status');
          if (inFilter) {
            if (selectedColumns === 'donor_id') {
              return { data: dbMock.alreadyDispatchedInEligibility || [], error: null };
            }
            return { data: dbMock.activeDispatches || [], error: null };
          }

          return { data: dbMock.donor_dispatches || [], error: null };
        }

        if (table === 'audit_logs') {
          if (dbMock.auditInsertError) {
            return { data: null, error: dbMock.auditInsertError };
          }
          if (insertedRows) {
            dbMock.audit_logs.push(...insertedRows);
          }
          return { data: insertedRows || [], error: null };
        }

        return { data: [], error: null };
      }
    };

    return queryBuilder;
  };

  // Mock global fetch for ML API calls
  globalThis.fetch = async (url, options = {}) => {
    if (typeof url === 'string' && url.includes('/predict')) {
      if (dbMock.mlFailure) {
        const err = new Error('ML inference failed');
        err.code = dbMock.mlFailure;
        throw err;
      }
      return {
        ok: true,
        json: async () => ({
          probability: 0.88,
          prediction: 1,
          model_version: 'donor_response_v1'
        })
      };
    }
    // Delegate other fetch calls to original fetch (e.g. localhost test server calls)
    return originalFetch(url, options);
  };
});

// ==========================================
// 1. Authentication & Role Boundaries
// ==========================================
test('POST donor-dispatches/next-batch: rejects missing Authorization header with 401', async () => {
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`);
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('POST donor-dispatches/next-batch: rejects malformed Authorization scheme with 401', async () => {
  const response = await fetch(`${baseUrl}/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {
    method: 'POST',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' }
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('POST donor-dispatches/next-batch: rejects invalid bearer token with 401', async () => {
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'invalid-token');
  assert.equal(status, 401);
  assert.equal(body.error, 'INVALID_TOKEN');
});

test('POST donor-dispatches/next-batch: rejects non-hospital roles with 403', async () => {
  for (const roleToken of ['donor-token', 'blood-bank-token', 'admin-token']) {
    const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, roleToken);
    assert.equal(status, 403, `Expected 403 for token: ${roleToken}`);
    assert.equal(body.error, 'FORBIDDEN');
  }
});

test('POST donor-dispatches/next-batch: rejects unprovisioned hospital user with 403', async () => {
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'unprovisioned-token');
  assert.equal(status, 403);
  assert.equal(body.error, 'HOSPITAL_NOT_PROVISIONED');
});

// ==========================================
// 2. Route Parameter & UUID Validation
// ==========================================
test('POST donor-dispatches/next-batch: rejects non-UUID requestId with 400', async () => {
  for (const invalidId of ['not-a-uuid', '12345', '00000000-0000-0000-0000-00000000000g']) {
    const { status, body } = await apiPost(`/api/requests/${invalidId}/donor-dispatches/next-batch`, {}, 'hospital-token');
    assert.equal(status, 400, `Expected 400 for requestId: ${invalidId}`);
    assert.equal(body.error, 'INVALID_REQUEST_ID');
  }
});

// ==========================================
// 3. Hospital Ownership & Request Existence
// ==========================================
test('POST donor-dispatches/next-batch: returns 404 when request is not found', async () => {
  dbMock.defaultEmergencyRequest = null;
  dbMock.emergency_requests[VALID_REQUEST_ID] = null;
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
  assert.equal(status, 404);
  assert.equal(body.error, 'REQUEST_NOT_FOUND');
});

test('POST donor-dispatches/next-batch: returns 403 when request belongs to another hospital', async () => {
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ hospital_id: OTHER_HOSPITAL_ID });
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
  assert.equal(body.message, 'Emergency request does not belong to this hospital');
});

// ==========================================
// 4. Request Lifecycle & State Validation
// ==========================================
test('POST donor-dispatches/next-batch: returns 409 when request is FULFILLED or CANCELLED', async () => {
  for (const invalidStatus of ['FULFILLED', 'CANCELLED', 'CLOSED', 'EXPIRED']) {
    dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ status: invalidStatus });
    const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
    assert.equal(status, 409, `Expected 409 for status: ${invalidStatus}`);
    assert.equal(body.error, 'REQUEST_NOT_OPEN');
  }
});

test('POST donor-dispatches/next-batch: allows OPEN and PARTIALLY_FULFILLED requests', async () => {
  for (const validStatus of ['OPEN', 'PARTIALLY_FULFILLED']) {
    resetDbMock();
    dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ status: validStatus, quantity: 3 });
    dbMock.donors = createTestDonors(3);
    const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
    assert.equal(status, 201, `Expected 201 for status: ${validStatus}`);
    assert.equal(body.batchSize, 3);
  }
});

// ==========================================
// 5. Batch Size Validation & Clamping
// ==========================================
test('POST donor-dispatches/next-batch: respects requested valid batchSize and clamps up to 5', async () => {
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 10 });
  dbMock.donors = createTestDonors(10);

  // Request batchSize = 2
  const res1 = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, { batchSize: 2 }, 'hospital-token');
  assert.equal(res1.status, 201);
  assert.equal(res1.body.batchSize, 2);

  // Request batchSize = 10 -> clamped to 5
  resetDbMock();
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 10 });
  dbMock.donors = createTestDonors(10);
  const res2 = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, { batchSize: 10 }, 'hospital-token');
  assert.equal(res2.status, 201);
  assert.equal(res2.body.batchSize, 5);

  // Invalid batchSize (negative or string) -> defaults to 5
  resetDbMock();
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 10 });
  dbMock.donors = createTestDonors(10);
  const res3 = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, { batchSize: -5 }, 'hospital-token');
  assert.equal(res3.status, 201);
  assert.equal(res3.body.batchSize, 5);
});

// ==========================================
// 6. Service Unit: Empty Candidate Handling
// ==========================================
test('createNextDonorDispatchBatch: returns NO_ELIGIBLE_DONORS when candidate pool is empty', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.donors = []; // no eligible donors

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.candidateCount, 0);
  assert.equal(result.batchNumber, null);
  assert.deepEqual(result.dispatches, []);
  assert.equal(result.notified, false);
  assert.equal(result.reason, 'NO_ELIGIBLE_DONORS');
});

test('createNextDonorDispatchBatch: returns NO_AVAILABLE_NEXT_BATCH when all candidates are already actively dispatched', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.emergency_requests[VALID_REQUEST_ID] = request;
  dbMock.donors = createTestDonors(3);
  // All 3 donors already have active dispatches
  dbMock.activeDispatches = [
    { donor_id: 'donor-uuid-1', status: 'PENDING' },
    { donor_id: 'donor-uuid-2', status: 'NOTIFIED' },
    { donor_id: 'donor-uuid-3', status: 'RESPONDED' }
  ];

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.candidateCount, 3);
  assert.equal(result.batchNumber, null);
  assert.deepEqual(result.dispatches, []);
  assert.equal(result.notified, false);
  assert.equal(result.reason, 'NO_AVAILABLE_NEXT_BATCH');
});

// ==========================================
// 7. Batch Numbering & Increment Logic
// ==========================================
test('createNextDonorDispatchBatch: starts at batch 1 when no previous batches exist', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);
  dbMock.latestBatchNumber = 0;

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.batchNumber, 1);
  assert.equal(result.dispatches.length, 2);
  assert.equal(result.dispatches[0].batch_number, 1);
});

test('createNextDonorDispatchBatch: increments to next batch number sequentially', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);
  dbMock.latestBatchNumber = 3;

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.batchNumber, 4);
  assert.equal(result.dispatches[0].batch_number, 4);
});

// ==========================================
// 8. Hardening: Candidate Backfill
// ==========================================
test('Candidate Backfill: backfills from rankedDonors pool when top candidates are already active', async () => {
  const request = createTestRequest({ quantity: 7 });
  dbMock.emergency_requests[VALID_REQUEST_ID] = request;
  // Provide 7 donors. Top 2 (donor-uuid-1 and donor-uuid-2) are active.
  dbMock.donors = createTestDonors(7);
  dbMock.activeDispatches = [
    { donor_id: 'donor-uuid-1', status: 'PENDING' },
    { donor_id: 'donor-uuid-2', status: 'ACCEPTED' }
  ];

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  // Must backfill candidates 3, 4, 5, 6, 7 to fulfill requested batch size of 5
  assert.equal(result.dispatches.length, 5);
  const dispatchedIds = result.dispatches.map((d) => d.donor_id);
  assert.ok(!dispatchedIds.includes('donor-uuid-1'));
  assert.ok(!dispatchedIds.includes('donor-uuid-2'));
  assert.deepEqual(dispatchedIds, [
    'donor-uuid-3',
    'donor-uuid-4',
    'donor-uuid-5',
    'donor-uuid-6',
    'donor-uuid-7'
  ]);
});

// ==========================================
// 9. Hardening: Over-Dispatch Protection
// ==========================================
test('Over-Dispatch Protection: request needing 1 unit cannot dispatch more than 1 donor', async () => {
  const request = createTestRequest({ quantity: 1 });
  dbMock.emergency_requests[VALID_REQUEST_ID] = request;
  dbMock.donors = createTestDonors(5);

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5 // Client requested 5, but request only needs 1
  });

  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].donor_id, 'donor-uuid-1');
});

test('Over-Dispatch Protection: accounts for reserved inventory allocations', async () => {
  const request = createTestRequest({ quantity: 3 });
  dbMock.emergency_requests[VALID_REQUEST_ID] = request;
  dbMock.donors = createTestDonors(5);
  // 2 units are already reserved from peer blood banks
  dbMock.request_inventory_allocations = [
    { allocated_units: 1, status: 'RESERVED' },
    { allocated_units: 1, status: 'RESERVED' }
  ];

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  // Only 1 unit needed -> creates exactly 1 dispatch
  assert.equal(result.dispatches.length, 1);
});

test('Over-Dispatch Protection: returns REQUEST_ALREADY_FULFILLED when required units are met', async () => {
  const request = createTestRequest({ quantity: 2 });
  dbMock.emergency_requests[VALID_REQUEST_ID] = request;
  dbMock.donors = createTestDonors(5);
  // 1 unit reserved in inventory, 1 unit accepted by donor -> 0 needed
  dbMock.request_inventory_allocations = [{ allocated_units: 1, status: 'RESERVED' }];
  dbMock.activeDispatches = [{ donor_id: 'prior-donor', status: 'ACCEPTED' }];

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.dispatches.length, 0);
  assert.equal(result.reason, 'REQUEST_ALREADY_FULFILLED');
});

// ==========================================
// 10. Hardening: Request State Revalidation
// ==========================================
test('Request State Revalidation: aborts batch creation if request became FULFILLED during ranking', async () => {
  const request = createTestRequest({ status: 'OPEN' });
  // Simulate concurrent fulfillment right before batch generation
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ status: 'FULFILLED' });
  dbMock.donors = createTestDonors(3);

  await assert.rejects(
    async () => {
      await createNextDonorDispatchBatch({
        request,
        actorUserId: VALID_ACTOR_USER_ID,
        batchSize: 5
      });
    },
    (err) => {
      assert.equal(err.code, 'REQUEST_NOT_OPEN');
      return true;
    }
  );
});

test('Request State Revalidation: HTTP endpoint returns 409 when request state changes to CANCELLED', async () => {
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ status: 'CANCELLED' });
  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
  assert.equal(status, 409);
  assert.equal(body.error, 'REQUEST_NOT_OPEN');
});

// ==========================================
// 11. Hardening: Audit Log Integrity & Fail-Closed Rollback
// ==========================================
test('Audit Integrity: successfully records audit log with metadata on batch creation', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);

  const result = await createNextDonorDispatchBatch({
    request,
    actorUserId: VALID_ACTOR_USER_ID,
    batchSize: 5
  });

  assert.equal(result.auditLogged, true);
  assert.equal(dbMock.audit_logs.length, 1);
  const log = dbMock.audit_logs[0];
  assert.equal(log.actor_user_id, VALID_ACTOR_USER_ID);
  assert.equal(log.action, 'DONOR_DISPATCH_BATCH_CREATED');
  assert.equal(log.entity_id, VALID_REQUEST_ID);
});

test('Audit Integrity: rolls back dispatches and fails-closed when audit log fails', async () => {
  const request = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);
  dbMock.auditInsertError = new Error('audit table unavailable');

  await assert.rejects(
    async () => {
      await createNextDonorDispatchBatch({
        request,
        actorUserId: VALID_ACTOR_USER_ID,
        batchSize: 5
      });
    },
    (err) => {
      assert.equal(err.code, 'AUDIT_LOG_FAILED');
      return true;
    }
  );

  // Verify compensating rollback deleted the inserted dispatches
  assert.equal(dbMock.donor_dispatches.length, 0);
  assert.ok(dbMock.deletedDispatches.length > 0);
});

test('Audit Integrity: HTTP endpoint returns 500 AUDIT_LOG_FAILED when audit insert fails', async () => {
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);
  dbMock.auditInsertError = new Error('audit service down');

  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
  assert.equal(status, 500);
  assert.equal(body.error, 'AUDIT_LOG_FAILED');
});

// ==========================================
// 12. Concurrency Conflict & ML Resilience
// ==========================================
test('POST donor-dispatches/next-batch: returns 409 DISPATCH_BATCH_CONFLICT on code 23505', async () => {
  dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 5 });
  dbMock.donors = createTestDonors(2);
  const conflictError = new Error('duplicate key value violates unique constraint');
  conflictError.code = '23505';
  dbMock.dispatchInsertError = conflictError;

  const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
  assert.equal(status, 409);
  assert.equal(body.error, 'DISPATCH_BATCH_CONFLICT');
  assert.equal(body.message, 'A donor dispatch changed concurrently; retry the batch request');
});

test('POST donor-dispatches/next-batch: gracefully falls back to deterministic ranking on ML service errors', async () => {
  for (const mlErrCode of ['ML_NOT_CONFIGURED', 'ML_TIMEOUT', 'ML_INFERENCE_FAILED']) {
    resetDbMock();
    dbMock.emergency_requests[VALID_REQUEST_ID] = createTestRequest({ quantity: 5 });
    dbMock.donors = createTestDonors(2);
    dbMock.mlFailure = mlErrCode;

    const { status, body } = await apiPost(`/api/requests/${VALID_REQUEST_ID}/donor-dispatches/next-batch`, {}, 'hospital-token');
    assert.equal(status, 201, `Expected 201 for ML fallback on: ${mlErrCode}`);
    assert.equal(body.modelVersion, null);
    assert.equal(body.rankingSource, 'DETERMINISTIC_FALLBACK');
    assert.equal(body.batchSize, 2);
    assert.equal(body.dispatches.length, 2);
  }
});
