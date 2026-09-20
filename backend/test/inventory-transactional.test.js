import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// LIFE-LINK PHASE 3: Inventory & Fulfilment Transactional Correctness
// ============================================================================

const localSupabaseUrl = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const localJwtSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

function generateServiceRoleToken(secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      role: 'service_role',
      iss: 'supabase',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 360000
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const serviceRoleToken = process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SECRET_KEY !== 'test-secret-key'
  ? process.env.SUPABASE_SECRET_KEY
  : generateServiceRoleToken(localJwtSecret);

// Probe local Supabase reachability
let isDatabaseReachable = false;
try {
  const probe = await fetch(`${localSupabaseUrl}/rest/v1/`, {
    signal: AbortSignal.timeout(1500)
  });
  if (probe.ok || probe.status === 401 || probe.status === 200) {
    isDatabaseReachable = true;
  }
} catch {
  isDatabaseReachable = false;
}

const client = isDatabaseReachable
  ? createClient(localSupabaseUrl, serviceRoleToken, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const skipReason = 'Local Docker Supabase database (http://127.0.0.1:54321) is not reachable.';

// Well-known test organization IDs from baseline fixtures
const HOSPITAL_A_ID = '10000000-0000-0000-0000-000000000001';
const BLOOD_BANK_A_ID = '20000000-0000-0000-0000-000000000001';
const BLOOD_BANK_B_ID = '20000000-0000-0000-0000-000000000002';

// Helper to create an isolated test inventory lot
async function createTestInventoryLot({
  bloodBankId = BLOOD_BANK_A_ID,
  bloodGroup = 'B_POSITIVE',
  componentType = 'WHOLE_BLOOD',
  availableUnits = 10,
  reservedUnits = 0,
  criticalLevel = 0,
  daysUntilExpiry = 30
} = {}) {
  const expiryDate = new Date(Date.now() + daysUntilExpiry * 86400000).toISOString();
  const { data, error } = await client
    .from('blood_inventory')
    .insert({
      blood_bank_id: bloodBankId,
      blood_group: bloodGroup,
      component_type: componentType,
      available_units: availableUnits,
      reserved_units: reservedUnits,
      critical_level: criticalLevel,
      expiry_date: expiryDate,
      is_synthetic: true
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create test inventory lot: ${error.message}`);
  return data;
}

// Helper to create a test emergency request
async function createTestEmergencyRequest({
  hospitalId = HOSPITAL_A_ID,
  bloodGroup = 'B_POSITIVE',
  resourceType = 'WHOLE_BLOOD',
  quantity = 5,
  urgency = 'HIGH',
  status = 'OPEN'
} = {}) {
  const { data, error } = await client
    .from('emergency_requests')
    .insert({
      hospital_id: hospitalId,
      blood_group: bloodGroup,
      resource_type: resourceType,
      quantity,
      urgency,
      status,
      is_synthetic: true
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create test emergency request: ${error.message}`);
  return data;
}

// Helper to clean up test rows safely
async function cleanupTestArtifacts({ requestIds = [], inventoryIds = [], offerIds = [] } = {}) {
  if (offerIds.length > 0) {
    await client.from('blood_bank_transfer_offers').delete().in('id', offerIds);
  }
  if (requestIds.length > 0) {
    await client.from('request_inventory_allocations').delete().in('request_id', requestIds);
    await client.from('emergency_requests').delete().in('id', requestIds);
  }
  if (inventoryIds.length > 0) {
    await client.from('request_inventory_allocations').delete().in('inventory_id', inventoryIds);
    await client.from('blood_inventory').delete().in('id', inventoryIds);
  }
}

// ============================================================================
// 1. DATABASE SCHEMA CONSTRAINTS & STRUCTURAL INTEGRITY
// ============================================================================

test('Schema: blood_inventory has non-negative check constraints and unique stock index', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Test negative available_units check constraint
  const { error: negAvailableError } = await client
    .from('blood_inventory')
    .insert({
      blood_bank_id: BLOOD_BANK_A_ID,
      blood_group: 'AB_NEGATIVE',
      component_type: 'PLATELETS',
      available_units: -1,
      reserved_units: 0,
      critical_level: 0,
      expiry_date: new Date(Date.now() + 86400000).toISOString()
    });
  assert.ok(negAvailableError, 'Negative available_units must violate check constraint');
  assert.equal(negAvailableError.code, '23514', 'PostgreSQL check constraint violation code 23514');

  // Test negative reserved_units check constraint
  const { error: negReservedError } = await client
    .from('blood_inventory')
    .insert({
      blood_bank_id: BLOOD_BANK_A_ID,
      blood_group: 'AB_NEGATIVE',
      component_type: 'PLATELETS',
      available_units: 5,
      reserved_units: -1,
      critical_level: 0,
      expiry_date: new Date(Date.now() + 86400000).toISOString()
    });
  assert.ok(negReservedError, 'Negative reserved_units must violate check constraint');
  assert.equal(negReservedError.code, '23514', 'PostgreSQL check constraint violation code 23514');
});

test('Schema: request_inventory_allocations enforces positive allocated_units and valid status', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const req = await createTestEmergencyRequest({ bloodGroup: 'AB_POSITIVE', quantity: 3 });
  const lot = await createTestInventoryLot({ bloodGroup: 'AB_POSITIVE', availableUnits: 5 });

  try {
    // 0 or negative allocated_units must fail
    const { error: zeroUnitsError } = await client
      .from('request_inventory_allocations')
      .insert({
        request_id: req.id,
        inventory_id: lot.id,
        blood_bank_id: BLOOD_BANK_A_ID,
        allocated_units: 0
      });
    assert.ok(zeroUnitsError, 'Zero allocated_units must violate check constraint');
    assert.equal(zeroUnitsError.code, '23514', 'PostgreSQL check constraint violation 23514');

    // Invalid status value must fail
    const { error: invalidStatusError } = await client
      .from('request_inventory_allocations')
      .insert({
        request_id: req.id,
        inventory_id: lot.id,
        blood_bank_id: BLOOD_BANK_A_ID,
        allocated_units: 1,
        status: 'INVALID_STATUS'
      });
    assert.ok(invalidStatusError, 'Invalid allocation status must violate check constraint');
    assert.equal(invalidStatusError.code, '23514', 'PostgreSQL check constraint violation 23514');
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

test('Schema: emergency_requests completion_check constraint enforces completed_at when FULFILLED', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const { error } = await client
    .from('emergency_requests')
    .insert({
      hospital_id: HOSPITAL_A_ID,
      blood_group: 'O_POSITIVE',
      resource_type: 'WHOLE_BLOOD',
      quantity: 1,
      urgency: 'MEDIUM',
      status: 'FULFILLED',
      completed_at: null // Violates emergency_requests_completion_check
    });
  assert.ok(error, 'FULFILLED request without completed_at must violate completion_check');
  assert.equal(error.code, '23514', 'PostgreSQL check constraint violation 23514');
});

// ============================================================================
// 2. ATOMIC INVENTORY RESERVATION & CONCURRENCY TESTS
// ============================================================================

test('Concurrency A: Two concurrent reservations where combined requested quantity exceeds stock', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Lot has exactly 5 units
  const lot = await createTestInventoryLot({ bloodGroup: 'B_NEGATIVE', availableUnits: 5 });
  // Request 1 wants 4 units; Request 2 wants 3 units. Sum = 7 > 5.
  const req1 = await createTestEmergencyRequest({ bloodGroup: 'B_NEGATIVE', quantity: 4 });
  const req2 = await createTestEmergencyRequest({ bloodGroup: 'B_NEGATIVE', quantity: 3 });

  try {
    // Launch both reservation calls concurrently
    const [res1, res2] = await Promise.all([
      client.rpc('reserve_blood_inventory', {
        p_request_id: req1.id,
        p_blood_group: 'B_NEGATIVE',
        p_component_type: 'WHOLE_BLOOD',
        p_quantity: 4
      }),
      client.rpc('reserve_blood_inventory', {
        p_request_id: req2.id,
        p_blood_group: 'B_NEGATIVE',
        p_component_type: 'WHOLE_BLOOD',
        p_quantity: 3
      })
    ]);

    assert.equal(res1.error, null, 'Reservation 1 should not error');
    assert.equal(res2.error, null, 'Reservation 2 should not error');

    const allocs1 = res1.data || [];
    const allocs2 = res2.data || [];
    const units1 = allocs1.reduce((sum, r) => sum + r.allocated_units, 0);
    const units2 = allocs2.reduce((sum, r) => sum + r.allocated_units, 0);

    // Total allocated across both concurrent requests must exactly equal available stock (5)
    assert.equal(units1 + units2, 5, 'Total allocated must exactly equal initial available stock of 5');

    // One got full (either 4 or 3), the other got whatever remained (1 or 2)
    assert.ok(
      (units1 === 4 && units2 === 1) || (units1 === 2 && units2 === 3),
      `Expected allocations (4, 1) or (2, 3), got (${units1}, ${units2})`
    );

    // Verify database postconditions on inventory lot
    const { data: updatedLot } = await client
      .from('blood_inventory')
      .select('available_units, reserved_units')
      .eq('id', lot.id)
      .single();

    assert.equal(updatedLot.available_units, 0, 'Available units must be exactly 0, never negative');
    assert.equal(updatedLot.reserved_units, 5, 'Reserved units must be exactly 5');

    // Verify allocations table rows
    const { data: allAllocations } = await client
      .from('request_inventory_allocations')
      .select('request_id, allocated_units, status')
      .in('request_id', [req1.id, req2.id]);

    const totalAllocatedDb = allAllocations.reduce((sum, r) => sum + r.allocated_units, 0);
    assert.equal(totalAllocatedDb, 5, 'Database allocations must total exactly 5');
    assert.equal(allAllocations.length, 2, 'Exactly 2 allocation records must exist');
    assert.ok(allAllocations.every((r) => r.status === 'RESERVED'), 'All allocations must be in RESERVED status');

    // Verify request statuses
    const { data: updatedReq1 } = await client.from('emergency_requests').select('status, completed_at').eq('id', req1.id).single();
    const { data: updatedReq2 } = await client.from('emergency_requests').select('status, completed_at').eq('id', req2.id).single();

    if (units1 === 4) {
      assert.equal(updatedReq1.status, 'FULFILLED', 'Req1 received 4/4 and must be FULFILLED');
      assert.ok(updatedReq1.completed_at, 'Req1 completed_at must be populated');
      assert.equal(updatedReq2.status, 'PARTIALLY_FULFILLED', 'Req2 received 1/3 and must be PARTIALLY_FULFILLED');
      assert.equal(updatedReq2.completed_at, null, 'Req2 completed_at must be null');
    } else {
      assert.equal(updatedReq2.status, 'FULFILLED', 'Req2 received 3/3 and must be FULFILLED');
      assert.ok(updatedReq2.completed_at, 'Req2 completed_at must be populated');
      assert.equal(updatedReq1.status, 'PARTIALLY_FULFILLED', 'Req1 received 2/4 and must be PARTIALLY_FULFILLED');
      assert.equal(updatedReq1.completed_at, null, 'Req1 completed_at must be null');
    }
  } finally {
    await cleanupTestArtifacts({ requestIds: [req1.id, req2.id], inventoryIds: [lot.id] });
  }
});

test('Concurrency B: Two concurrent reservations where combined quantity exactly equals stock', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Lot has 6 units
  const lot = await createTestInventoryLot({ bloodGroup: 'A_NEGATIVE', availableUnits: 6 });
  // Request 1 wants 2 units; Request 2 wants 4 units. Sum = 6 == 6.
  const req1 = await createTestEmergencyRequest({ bloodGroup: 'A_NEGATIVE', quantity: 2 });
  const req2 = await createTestEmergencyRequest({ bloodGroup: 'A_NEGATIVE', quantity: 4 });

  try {
    const [res1, res2] = await Promise.all([
      client.rpc('reserve_blood_inventory', {
        p_request_id: req1.id,
        p_blood_group: 'A_NEGATIVE',
        p_component_type: 'WHOLE_BLOOD',
        p_quantity: 2
      }),
      client.rpc('reserve_blood_inventory', {
        p_request_id: req2.id,
        p_blood_group: 'A_NEGATIVE',
        p_component_type: 'WHOLE_BLOOD',
        p_quantity: 4
      })
    ]);

    assert.equal(res1.error, null);
    assert.equal(res2.error, null);

    const units1 = (res1.data || []).reduce((sum, r) => sum + r.allocated_units, 0);
    const units2 = (res2.data || []).reduce((sum, r) => sum + r.allocated_units, 0);

    assert.equal(units1, 2, 'Req1 should receive all 2 requested units');
    assert.equal(units2, 4, 'Req2 should receive all 4 requested units');

    // Verify stock cleanly drained to 0
    const { data: updatedLot } = await client
      .from('blood_inventory')
      .select('available_units, reserved_units')
      .eq('id', lot.id)
      .single();

    assert.equal(updatedLot.available_units, 0);
    assert.equal(updatedLot.reserved_units, 6);

    // Both requests must be FULFILLED
    const { data: updatedReq1 } = await client.from('emergency_requests').select('status, completed_at').eq('id', req1.id).single();
    const { data: updatedReq2 } = await client.from('emergency_requests').select('status, completed_at').eq('id', req2.id).single();

    assert.equal(updatedReq1.status, 'FULFILLED');
    assert.ok(updatedReq1.completed_at);
    assert.equal(updatedReq2.status, 'FULFILLED');
    assert.ok(updatedReq2.completed_at);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req1.id, req2.id], inventoryIds: [lot.id] });
  }
});

test('Scenario C: Reservation against insufficient stock allocates available and transitions to PARTIALLY_FULFILLED', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Lot has 2 units; Request asks for 5 units
  const lot = await createTestInventoryLot({ bloodGroup: 'AB_NEGATIVE', availableUnits: 2 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'AB_NEGATIVE', quantity: 5 });

  try {
    const { data, error } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'AB_NEGATIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 5
    });

    assert.equal(error, null);
    assert.equal(data.length, 1);
    assert.equal(data[0].allocated_units, 2);
    assert.equal(data[0].remaining_request_units, 3);

    // Verify postconditions
    const { data: updatedLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(updatedLot.available_units, 0);
    assert.equal(updatedLot.reserved_units, 2);

    const { data: updatedReq } = await client.from('emergency_requests').select('status, completed_at').eq('id', req.id).single();
    assert.equal(updatedReq.status, 'PARTIALLY_FULFILLED');
    assert.equal(updatedReq.completed_at, null);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

test('Scenario D: Repeated reservation attempt for already fulfilled request fails deterministically (Idempotency)', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({ bloodGroup: 'O_NEGATIVE', availableUnits: 10 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'O_NEGATIVE', quantity: 3 });

  try {
    // First reservation fulfills the request
    const { data: firstRes, error: firstErr } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'O_NEGATIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 3
    });
    assert.equal(firstErr, null);
    assert.equal(firstRes[0].allocated_units, 3);

    // Second reservation attempt on the now-FULFILLED request
    const { data: secondRes, error: secondErr } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'O_NEGATIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 3
    });

    assert.ok(secondErr, 'Second reservation on FULFILLED request must be rejected');
    assert.equal(secondErr.code, '55000', 'Must return error code 55000 (request not open)');

    // Verify no double deduction: lot available must still be 7, reserved must still be 3
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 7);
    assert.equal(checkLot.reserved_units, 3);

    // Verify allocations table still has exactly 1 row of 3 units
    const { data: allocs } = await client.from('request_inventory_allocations').select('*').eq('request_id', req.id);
    assert.equal(allocs.length, 1);
    assert.equal(allocs[0].allocated_units, 3);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

test('Scenario E: Failed reservation leaves inventory and allocation state completely unchanged', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({ bloodGroup: 'B_POSITIVE', availableUnits: 8, reservedUnits: 1 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'B_POSITIVE', quantity: 4 });

  try {
    // Attempt reservation with mismatched component_type
    const { error: mismatchErr } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'B_POSITIVE',
      p_component_type: 'PLATELETS', // request is WHOLE_BLOOD
      p_quantity: 4
    });

    assert.ok(mismatchErr, 'Mismatched resource must throw error');
    assert.equal(mismatchErr.code, '22023');

    // Attempt reservation with invalid zero quantity
    const { error: zeroQtyErr } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'B_POSITIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 0
    });

    assert.ok(zeroQtyErr, 'Zero quantity must throw error');
    assert.equal(zeroQtyErr.code, '22023');

    // Verify inventory state is completely unmodified
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 8);
    assert.equal(checkLot.reserved_units, 1);

    // Verify 0 allocations exist
    const { data: allocs } = await client.from('request_inventory_allocations').select('id').eq('request_id', req.id);
    assert.equal(allocs.length, 0);

    // Verify request remains OPEN
    const { data: checkReq } = await client.from('emergency_requests').select('status, completed_at').eq('id', req.id).single();
    assert.equal(checkReq.status, 'OPEN');
    assert.equal(checkReq.completed_at, null);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

test('Scenario F: Successful reservation updates inventory and allocation consistently', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({ bloodGroup: 'A_POSITIVE', availableUnits: 10, reservedUnits: 0 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'A_POSITIVE', quantity: 3 });

  try {
    const { data, error } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'A_POSITIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 3
    });

    assert.equal(error, null);
    assert.equal(data.length, 1);
    assert.equal(data[0].allocated_units, 3);
    assert.equal(data[0].remaining_request_units, 0);

    // Postconditions
    const { data: updatedLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(updatedLot.available_units, 7);
    assert.equal(updatedLot.reserved_units, 3);

    const { data: allocs } = await client.from('request_inventory_allocations').select('*').eq('request_id', req.id);
    assert.equal(allocs.length, 1);
    assert.equal(allocs[0].inventory_id, lot.id);
    assert.equal(allocs[0].allocated_units, 3);
    assert.equal(allocs[0].status, 'RESERVED');

    const { data: updatedReq } = await client.from('emergency_requests').select('status, completed_at').eq('id', req.id).single();
    assert.equal(updatedReq.status, 'FULFILLED');
    assert.ok(updatedReq.completed_at);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

// ============================================================================
// 3. FULFILMENT CONSISTENCY: 0 STOCK PRESERVATION
// ============================================================================

test('Fulfilment: Request with 0 available inventory remains OPEN, not PARTIALLY_FULFILLED', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Lot has 0 available units
  const lot = await createTestInventoryLot({ bloodGroup: 'AB_POSITIVE', availableUnits: 0, reservedUnits: 0 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'AB_POSITIVE', quantity: 5 });

  try {
    assert.equal(req.status, 'OPEN');

    const { data, error } = await client.rpc('reserve_blood_inventory', {
      p_request_id: req.id,
      p_blood_group: 'AB_POSITIVE',
      p_component_type: 'WHOLE_BLOOD',
      p_quantity: 5
    });

    assert.equal(error, null);
    assert.equal((data || []).length, 0, 'Zero allocations returned');

    // Request status must remain OPEN because 0 units were allocated
    const { data: updatedReq } = await client.from('emergency_requests').select('status, completed_at').eq('id', req.id).single();
    assert.equal(updatedReq.status, 'OPEN', 'Status must remain OPEN when 0 units are allocated');
    assert.equal(updatedReq.completed_at, null);

    // Inventory must remain 0 available, 0 reserved
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 0);
    assert.equal(checkLot.reserved_units, 0);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

// ============================================================================
// 4. PEER TRANSFER CONSISTENCY
// ============================================================================

test('Peer Transfer: Offer cannot be accepted twice (Sequential & Retry Idempotency)', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({
    bloodBankId: BLOOD_BANK_B_ID,
    bloodGroup: 'B_NEGATIVE',
    availableUnits: 8,
    criticalLevel: 1
  });
  const req = await createTestEmergencyRequest({ bloodGroup: 'B_NEGATIVE', quantity: 3 });

  const { data: offer, error: offerErr } = await client
    .from('blood_bank_transfer_offers')
    .insert({
      request_id: req.id,
      blood_bank_id: BLOOD_BANK_B_ID,
      blood_group: 'B_NEGATIVE',
      component_type: 'WHOLE_BLOOD',
      offered_units: 3,
      status: 'OFFERED'
    })
    .select()
    .single();

  assert.equal(offerErr, null);

  try {
    // First acceptance succeeds
    const { data: accept1, error: err1 } = await client.rpc('accept_blood_bank_transfer_offer', {
      p_offer_id: offer.id,
      p_blood_bank_id: BLOOD_BANK_B_ID
    });

    assert.equal(err1, null);
    assert.equal(accept1[0].reserved_units, 3);
    assert.equal(accept1[0].remaining_request_units, 0);

    // Second acceptance attempt on the same offer must fail with 55000
    const { data: accept2, error: err2 } = await client.rpc('accept_blood_bank_transfer_offer', {
      p_offer_id: offer.id,
      p_blood_bank_id: BLOOD_BANK_B_ID
    });

    assert.ok(err2, 'Duplicate acceptance must throw error');
    assert.equal(err2.code, '55000', 'Error code 55000: transfer offer is no longer available');

    // Verify source inventory was deducted ONLY ONCE (8 - 3 = 5 available, 3 reserved)
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 5);
    assert.equal(checkLot.reserved_units, 3);

    // Verify offer status is ACCEPTED
    const { data: checkOffer } = await client.from('blood_bank_transfer_offers').select('status').eq('id', offer.id).single();
    assert.equal(checkOffer.status, 'ACCEPTED');
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id], offerIds: [offer.id] });
  }
});

test('Peer Transfer: Concurrent acceptance attempts on the same offer cannot both succeed', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({
    bloodBankId: BLOOD_BANK_B_ID,
    bloodGroup: 'A_POSITIVE',
    availableUnits: 10,
    criticalLevel: 2
  });
  const req = await createTestEmergencyRequest({ bloodGroup: 'A_POSITIVE', quantity: 4 });

  const { data: offer } = await client
    .from('blood_bank_transfer_offers')
    .insert({
      request_id: req.id,
      blood_bank_id: BLOOD_BANK_B_ID,
      blood_group: 'A_POSITIVE',
      component_type: 'WHOLE_BLOOD',
      offered_units: 4,
      status: 'OFFERED'
    })
    .select()
    .single();

  try {
    // Launch two concurrent acceptance calls for the exact same offer
    const [res1, res2] = await Promise.all([
      client.rpc('accept_blood_bank_transfer_offer', {
        p_offer_id: offer.id,
        p_blood_bank_id: BLOOD_BANK_B_ID
      }),
      client.rpc('accept_blood_bank_transfer_offer', {
        p_offer_id: offer.id,
        p_blood_bank_id: BLOOD_BANK_B_ID
      })
    ]);

    // Exactly one should succeed, exactly one should fail with 55000
    const successCount = [res1, res2].filter((r) => !r.error).length;
    const failureCount = [res1, res2].filter((r) => r.error && r.error.code === '55000').length;

    assert.equal(successCount, 1, 'Exactly one concurrent acceptance must succeed');
    assert.equal(failureCount, 1, 'Exactly one concurrent acceptance must fail with 55000');

    // Verify source inventory was deducted ONLY ONCE (10 - 4 = 6)
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 6);
    assert.equal(checkLot.reserved_units, 4);

    // Verify exactly one allocation row created
    const { data: allocs } = await client.from('request_inventory_allocations').select('*').eq('request_id', req.id);
    assert.equal(allocs.length, 1);
    assert.equal(allocs[0].allocated_units, 4);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id], offerIds: [offer.id] });
  }
});

test('Peer Transfer: Insufficient source inventory fails safely with rollback (no partial mutation)', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  // Lot has 3 units, but critical_level is 2. Transferable = 3 - 2 = 1.
  // Offer is for 2 units (> 1 transferable).
  const lot = await createTestInventoryLot({
    bloodBankId: BLOOD_BANK_B_ID,
    bloodGroup: 'B_POSITIVE',
    availableUnits: 3,
    criticalLevel: 2
  });
  const req = await createTestEmergencyRequest({ bloodGroup: 'B_POSITIVE', quantity: 2 });

  const { data: offer } = await client
    .from('blood_bank_transfer_offers')
    .insert({
      request_id: req.id,
      blood_bank_id: BLOOD_BANK_B_ID,
      blood_group: 'B_POSITIVE',
      component_type: 'WHOLE_BLOOD',
      offered_units: 2,
      status: 'OFFERED'
    })
    .select()
    .single();

  try {
    const { error } = await client.rpc('accept_blood_bank_transfer_offer', {
      p_offer_id: offer.id,
      p_blood_bank_id: BLOOD_BANK_B_ID
    });

    assert.ok(error, 'Must fail when insufficient transferable stock');
    assert.equal(error.code, '40001', 'Error code 40001: insufficient transferable inventory for this offer');

    // Verify complete rollback: inventory unchanged
    const { data: checkLot } = await client.from('blood_inventory').select('available_units, reserved_units').eq('id', lot.id).single();
    assert.equal(checkLot.available_units, 3, 'Available units must remain 3');
    assert.equal(checkLot.reserved_units, 0, 'Reserved units must remain 0');

    // Offer must remain OFFERED (not ACCEPTED)
    const { data: checkOffer } = await client.from('blood_bank_transfer_offers').select('status').eq('id', offer.id).single();
    assert.equal(checkOffer.status, 'OFFERED');

    // Allocations must have 0 rows
    const { data: allocs } = await client.from('request_inventory_allocations').select('id').eq('request_id', req.id);
    assert.equal(allocs.length, 0);

    // Request remains OPEN
    const { data: checkReq } = await client.from('emergency_requests').select('status').eq('id', req.id).single();
    assert.equal(checkReq.status, 'OPEN');
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id], offerIds: [offer.id] });
  }
});

test('Peer Transfer: Acceptance updates request status consistently (partial vs full)', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  const lot = await createTestInventoryLot({
    bloodBankId: BLOOD_BANK_B_ID,
    bloodGroup: 'AB_POSITIVE',
    availableUnits: 10,
    criticalLevel: 0
  });
  // Request for 5 units; Offer for 2 units
  const req = await createTestEmergencyRequest({ bloodGroup: 'AB_POSITIVE', quantity: 5 });

  const { data: offer } = await client
    .from('blood_bank_transfer_offers')
    .insert({
      request_id: req.id,
      blood_bank_id: BLOOD_BANK_B_ID,
      blood_group: 'AB_POSITIVE',
      component_type: 'WHOLE_BLOOD',
      offered_units: 2,
      status: 'OFFERED'
    })
    .select()
    .single();

  try {
    const { data, error } = await client.rpc('accept_blood_bank_transfer_offer', {
      p_offer_id: offer.id,
      p_blood_bank_id: BLOOD_BANK_B_ID
    });

    assert.equal(error, null);
    assert.equal(data[0].reserved_units, 2);
    assert.equal(data[0].remaining_request_units, 3);

    // Request must transition to PARTIALLY_FULFILLED
    const { data: updatedReq } = await client.from('emergency_requests').select('status, completed_at').eq('id', req.id).single();
    assert.equal(updatedReq.status, 'PARTIALLY_FULFILLED');
    assert.equal(updatedReq.completed_at, null);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id], offerIds: [offer.id] });
  }
});

// ============================================================================
// 5. APPLICATION SERVICE LAYER INTEGRATION
// ============================================================================

test('Service Layer: reserveBloodInventory service function correctly maps results', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  process.env.SUPABASE_URL = localSupabaseUrl;
  process.env.SUPABASE_SECRET_KEY = serviceRoleToken;
  const { reserveBloodInventory } = await import('../src/services/inventoryService.js');

  const lot = await createTestInventoryLot({ bloodGroup: 'O_NEGATIVE', componentType: 'PLATELETS', availableUnits: 5 });
  const req = await createTestEmergencyRequest({ bloodGroup: 'O_NEGATIVE', resourceType: 'PLATELETS', quantity: 3 });

  try {
    const result = await reserveBloodInventory({
      requestId: req.id,
      bloodGroup: 'O_NEGATIVE',
      componentType: 'PLATELETS',
      quantity: 3
    });

    assert.equal(result.allocatedUnits, 3);
    assert.equal(result.remainingUnits, 0);
    assert.equal(result.fullyReserved, true);
    assert.equal(result.allocations.length, 1);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id] });
  }
});

test('Service Layer: acceptPeerTransferOffer service function correctly executes transfer', { skip: !isDatabaseReachable ? skipReason : false }, async () => {
  process.env.SUPABASE_URL = localSupabaseUrl;
  process.env.SUPABASE_SECRET_KEY = serviceRoleToken;
  const { acceptPeerTransferOffer } = await import('../src/services/peerTransferAcceptanceService.js');

  const lot = await createTestInventoryLot({
    bloodBankId: BLOOD_BANK_A_ID,
    bloodGroup: 'B_NEGATIVE',
    componentType: 'RED_BLOOD_CELLS',
    availableUnits: 6,
    criticalLevel: 1
  });
  const req = await createTestEmergencyRequest({ bloodGroup: 'B_NEGATIVE', resourceType: 'RED_BLOOD_CELLS', quantity: 2 });

  const { data: offer } = await client
    .from('blood_bank_transfer_offers')
    .insert({
      request_id: req.id,
      blood_bank_id: BLOOD_BANK_A_ID,
      blood_group: 'B_NEGATIVE',
      component_type: 'RED_BLOOD_CELLS',
      offered_units: 2,
      status: 'OFFERED'
    })
    .select()
    .single();

  try {
    const result = await acceptPeerTransferOffer({
      offerId: offer.id,
      bloodBankId: BLOOD_BANK_A_ID
    });

    assert.equal(result.offer_id, offer.id);
    assert.equal(result.reserved_units, 2);
    assert.equal(result.remaining_request_units, 0);
  } finally {
    await cleanupTestArtifacts({ requestIds: [req.id], inventoryIds: [lot.id], offerIds: [offer.id] });
  }
});

