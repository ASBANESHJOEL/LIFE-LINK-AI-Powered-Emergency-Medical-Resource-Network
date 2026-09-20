import './setup.js';
import test, { beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// LIFE-LINK PHASE 5: Emergency Resource Orchestration & Production Hardening
// Full Integration Test Suite on Local Docker Supabase
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

const client = createClient(localSupabaseUrl, serviceRoleToken, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const HOSPITAL_A_ID = '10000000-0000-0000-0000-000000000001';
const BLOOD_BANK_A_ID = '20000000-0000-0000-0000-000000000001';
const BLOOD_BANK_B_ID = '20000000-0000-0000-0000-000000000002';
let currentTestArtifacts = { requestIds: [], inventoryIds: [], offerIds: [], dispatchIds: [], userIds: [] };

async function cleanupOrchestrationArtifacts(artifacts) {
  if (!artifacts) return;
  const { requestIds = [], inventoryIds = [], offerIds = [], dispatchIds = [], userIds = [] } = artifacts;

  if (dispatchIds.length > 0) {
    await client.from('live_locations').delete().in('dispatch_id', dispatchIds);
    await client.from('donor_dispatches').delete().in('id', dispatchIds);
  }
  if (offerIds.length > 0) {
    await client.from('blood_bank_transfer_offers').delete().in('id', offerIds);
  }
  if (requestIds.length > 0) {
    await client.from('request_inventory_allocations').delete().in('request_id', requestIds);
    await client.from('blood_bank_transfer_offers').delete().in('request_id', requestIds);
    await client.from('donor_dispatches').delete().in('request_id', requestIds);
    await client.from('emergency_requests').delete().in('id', requestIds);
  }
  if (inventoryIds.length > 0) {
    await client.from('request_inventory_allocations').delete().in('inventory_id', inventoryIds);
    await client.from('blood_inventory').delete().in('id', inventoryIds);
  }
  if (userIds.length > 0) {
    await client.from('donors').delete().in('user_id', userIds);
    await client.from('users').delete().in('id', userIds);
  }
}

afterEach(async () => {
  const toClean = currentTestArtifacts;
  currentTestArtifacts = { requestIds: [], inventoryIds: [], offerIds: [], dispatchIds: [], userIds: [] };
  await cleanupOrchestrationArtifacts(toClean);
});

after(async () => {
  const toClean = currentTestArtifacts;
  currentTestArtifacts = { requestIds: [], inventoryIds: [], offerIds: [], dispatchIds: [], userIds: [] };
  await cleanupOrchestrationArtifacts(toClean);
});

async function createTestUser(emailPrefix, role = 'DONOR') {
  const userId = crypto.randomUUID();
  const { data, error } = await client.from('users').insert({
    id: userId,
    email: `${emailPrefix}_${Date.now()}_${Math.random().toString(36).substring(7)}@test.lifelink.org`,
    role,
    is_active: true
  }).select().single();
  if (error) throw new Error(`User create failed: ${error.message}`);
  currentTestArtifacts.userIds.push(data.id);
  return data;
}

async function createTestDonor(user, overrides = {}) {
  const { data, error } = await client.from('donors').insert({
    user_id: user.id,
    name: 'Phase 5 Test Donor',
    blood_group: 'O_POSITIVE',
    verified: true,
    availability_status: 'AVAILABLE',
    eligibility_status: 'ELIGIBLE',
    current_latitude: 12.9716,
    current_longitude: 77.5946,
    live_location_enabled: true,
    is_synthetic: true,
    ...overrides
  }).select().single();
  if (error) throw new Error(`Donor create failed: ${error.message}`);
  return data;
}

async function createEmergencyRequest(overrides = {}) {
  const { data, error } = await client.from('emergency_requests').insert({
    hospital_id: HOSPITAL_A_ID,
    blood_group: 'O_POSITIVE',
    resource_type: 'WHOLE_BLOOD',
    quantity: 2,
    urgency: 'CRITICAL',
    status: 'OPEN',
    hospital_latitude: 12.9716,
    hospital_longitude: 77.5946,
    is_synthetic: true,
    ...overrides
  }).select().single();
  if (error) throw new Error(`Request create failed: ${error.message}`);
  currentTestArtifacts.requestIds.push(data.id);
  return data;
}

async function createTestInventory(bloodBankId, overrides = {}) {
  const { data, error } = await client.from('blood_inventory').insert({
    blood_bank_id: bloodBankId,
    blood_group: 'O_POSITIVE',
    component_type: 'WHOLE_BLOOD',
    available_units: 10,
    reserved_units: 0,
    critical_level: 1,
    expiry_date: new Date(Date.now() + 14 * 86400000).toISOString(),
    is_synthetic: true,
    ...overrides
  }).select().single();
  if (error) throw new Error(`Inventory create failed: ${error.message}`);
  currentTestArtifacts.inventoryIds.push(data.id);
  return data;
}

async function createTestDispatch(requestId, donorId, overrides = {}) {
  const { data, error } = await client.from('donor_dispatches').insert({
    request_id: requestId,
    donor_id: donorId,
    batch_number: 1,
    priority_score: 0.95,
    status: 'NOTIFIED',
    notified_at: new Date().toISOString(),
    is_synthetic: true,
    ...overrides
  }).select().single();
  if (error) throw new Error(`Dispatch create failed: ${error.message}`);
  currentTestArtifacts.dispatchIds.push(data.id);
  return data;
}

// ============================================================================
// PART 1: EMERGENCY REQUEST STATE MACHINE & TRANSITION ENFORCEMENT
// ============================================================================

test('STATE MACHINE: Resource-backed forward transitions OPEN -> PARTIALLY_FULFILLED -> FULFILLED via actual allocations', async () => {
  // 1. Create OPEN request
  const req = await createEmergencyRequest({
    blood_group: 'A_NEGATIVE',
    resource_type: 'PLATELETS',
    quantity: 4,
    status: 'OPEN'
  });
  assert.equal(req.status, 'OPEN');

  // 2. Create matching inventory
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'A_NEGATIVE',
    component_type: 'PLATELETS',
    available_units: 4,
    reserved_units: 0
  });

  // 3. Reserve partial quantity (2 units)
  const { data: res1, error: err1 } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'A_NEGATIVE',
    p_component_type: 'PLATELETS',
    p_quantity: 2
  });
  assert.equal(err1, null);
  assert.equal(res1[0].allocated_units, 2);

  // 4. Verify request transitioned to PARTIALLY_FULFILLED
  const { data: partReq } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(partReq.status, 'PARTIALLY_FULFILLED');

  // 5. Reserve remaining quantity (2 units)
  const { data: res2, error: err2 } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'A_NEGATIVE',
    p_component_type: 'PLATELETS',
    p_quantity: 2
  });
  assert.equal(err2, null);
  assert.equal(res2[0].allocated_units, 2);

  // 6. Verify request transitioned to FULFILLED
  const { data: fullReq } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(fullReq.status, 'FULFILLED');
  assert.ok(fullReq.completed_at);

  // 7. Verify request_inventory_allocations contain the expected quantity
  const { data: allocs } = await client.from('request_inventory_allocations').select().eq('request_id', req.id);
  const totalAllocated = allocs.reduce((sum, a) => sum + a.allocated_units, 0);
  assert.equal(totalAllocated, 4);
  assert.ok(allocs.every(a => a.status === 'RESERVED'));
});

test('STATE MACHINE: Direct mutation to FULFILLED without actual allocations is rejected by trigger', async () => {
  const req = await createEmergencyRequest({ quantity: 2, status: 'OPEN' });

  const { error } = await client
    .from('emergency_requests')
    .update({ status: 'FULFILLED', completed_at: new Date().toISOString() })
    .eq('id', req.id);

  assert.ok(error, 'Direct mutation to FULFILLED with zero allocations must be rejected');
  assert.equal(error.code, '55000');

  const { data: checkReq } = await client.from('emergency_requests').select('status').eq('id', req.id).single();
  assert.equal(checkReq.status, 'OPEN');
});

test('STATE MACHINE: Direct mutation to PARTIALLY_FULFILLED with zero actual allocation is rejected by trigger', async () => {
  const req = await createEmergencyRequest({ quantity: 2, status: 'OPEN' });

  const { error } = await client
    .from('emergency_requests')
    .update({ status: 'PARTIALLY_FULFILLED' })
    .eq('id', req.id);

  assert.ok(error, 'Direct mutation to PARTIALLY_FULFILLED with zero allocations must be rejected');
  assert.equal(error.code, '55000');

  const { data: checkReq } = await client.from('emergency_requests').select('status').eq('id', req.id).single();
  assert.equal(checkReq.status, 'OPEN');
});

test('STATE MACHINE: Rejection of invalid transitions from terminal FULFILLED', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'FULFILLED', completed_at: new Date().toISOString() });

  const { error: openErr } = await client.from('emergency_requests').update({ status: 'OPEN' }).eq('id', req.id);
  assert.ok(openErr);
  assert.equal(openErr.code, '55000');

  const { error: cancelErr } = await client.from('emergency_requests').update({ status: 'CANCELLED' }).eq('id', req.id);
  assert.ok(cancelErr);
  assert.equal(cancelErr.code, '55000');

  const { error: expireErr } = await client.from('emergency_requests').update({ status: 'EXPIRED' }).eq('id', req.id);
  assert.ok(expireErr);
  assert.equal(expireErr.code, '55000');
});

test('STATE MACHINE: Rejection of invalid transitions from terminal CANCELLED and EXPIRED', async () => {
  const cancelledReq = await createEmergencyRequest({ quantity: 1, status: 'CANCELLED' });

  const { error: canOpenErr } = await client.from('emergency_requests').update({ status: 'OPEN' }).eq('id', cancelledReq.id);
  assert.ok(canOpenErr);
  assert.equal(canOpenErr.code, '55000');

  const { error: canFullErr } = await client.from('emergency_requests').update({ status: 'FULFILLED' }).eq('id', cancelledReq.id);
  assert.ok(canFullErr);
  assert.equal(canFullErr.code, '55000');

  const expiredReq = await createEmergencyRequest({ quantity: 1, status: 'EXPIRED' });

  const { error: expOpenErr } = await client.from('emergency_requests').update({ status: 'OPEN' }).eq('id', expiredReq.id);
  assert.ok(expOpenErr);
  assert.equal(expOpenErr.code, '55000');
});

test('STATE MACHINE: Idempotent self-transitions are permitted', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'CANCELLED' });
  const { data, error } = await client.from('emergency_requests').update({ status: 'CANCELLED' }).eq('id', req.id).select().single();
  assert.equal(error, null);
  assert.equal(data.status, 'CANCELLED');
});

// ============================================================================
// PART 2: ATOMIC INVENTORY ORCHESTRATION
// ============================================================================

test('INVENTORY ORCHESTRATION: reserve_blood_inventory is atomic, conserves inventory, and sets correct request status', async () => {
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'B_NEGATIVE',
    component_type: 'PLATELETS',
    available_units: 5,
    reserved_units: 0
  });
  const req = await createEmergencyRequest({
    blood_group: 'B_NEGATIVE',
    resource_type: 'PLATELETS',
    quantity: 3,
    status: 'OPEN'
  });

  const { data: resData, error: resErr } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'B_NEGATIVE',
    p_component_type: 'PLATELETS',
    p_quantity: 3
  });
  assert.equal(resErr, null);
  assert.equal(resData.length, 1);
  assert.equal(resData[0].allocated_units, 3);
  assert.equal(resData[0].remaining_request_units, 0);

  const { data: updatedInv } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(updatedInv.available_units, 2);
  assert.equal(updatedInv.reserved_units, 3);

  const { data: allocs } = await client.from('request_inventory_allocations').select().eq('request_id', req.id);
  assert.equal(allocs.length, 1);
  assert.equal(allocs[0].allocated_units, 3);
  assert.equal(allocs[0].status, 'RESERVED');

  const { data: updatedReq } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(updatedReq.status, 'FULFILLED');
  assert.ok(updatedReq.completed_at);
});

test('INVENTORY ORCHESTRATION: Partial inventory reservation transitions request to PARTIALLY_FULFILLED', async () => {
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'AB_NEGATIVE',
    component_type: 'PLASMA',
    available_units: 2,
    reserved_units: 0
  });
  const req = await createEmergencyRequest({
    blood_group: 'AB_NEGATIVE',
    resource_type: 'PLASMA',
    quantity: 5,
    status: 'OPEN'
  });

  const { data: resData, error: resErr } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'AB_NEGATIVE',
    p_component_type: 'PLASMA',
    p_quantity: 5
  });
  assert.equal(resErr, null);
  assert.equal(resData.length, 1);
  assert.equal(resData[0].allocated_units, 2);
  assert.equal(resData[0].remaining_request_units, 3);

  const { data: updatedReq } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(updatedReq.status, 'PARTIALLY_FULFILLED');
  assert.equal(updatedReq.completed_at, null);
});

// ============================================================================
// PART 3: PEER BLOOD-BANK TRANSFERS
// ============================================================================

test('PEER TRANSFER: Authorized transfer acceptance moves inventory atomically and updates request allocation', async () => {
  const inv = await createTestInventory(BLOOD_BANK_B_ID, {
    blood_group: 'AB_POSITIVE',
    component_type: 'RED_BLOOD_CELLS',
    available_units: 6,
    reserved_units: 0,
    critical_level: 1
  });
  const req = await createEmergencyRequest({
    blood_group: 'AB_POSITIVE',
    resource_type: 'RED_BLOOD_CELLS',
    quantity: 2,
    status: 'OPEN'
  });

  const { data: offer, error: offerErr } = await client.from('blood_bank_transfer_offers').insert({
    request_id: req.id,
    blood_bank_id: BLOOD_BANK_B_ID,
    blood_group: 'AB_POSITIVE',
    component_type: 'RED_BLOOD_CELLS',
    offered_units: 2,
    status: 'OFFERED'
  }).select().single();
  assert.equal(offerErr, null);

  const { data: acceptData, error: acceptErr } = await client.rpc('accept_blood_bank_transfer_offer', {
    p_offer_id: offer.id,
    p_blood_bank_id: BLOOD_BANK_B_ID
  });
  assert.equal(acceptErr, null);
  assert.equal(acceptData[0].reserved_units, 2);
  assert.equal(acceptData[0].remaining_request_units, 0);

  const { data: updatedInv } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(updatedInv.available_units, 4);
  assert.equal(updatedInv.reserved_units, 2);

  const { data: updatedOffer } = await client.from('blood_bank_transfer_offers').select().eq('id', offer.id).single();
  assert.equal(updatedOffer.status, 'ACCEPTED');

  const { data: updatedReq } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(updatedReq.status, 'FULFILLED');
});

test('PEER TRANSFER: Attempting to accept the same offer twice is rejected (Idempotency / Conflict)', async () => {
  await createTestInventory(BLOOD_BANK_B_ID, {
    blood_group: 'A_NEGATIVE',
    component_type: 'PLASMA',
    available_units: 5,
    critical_level: 1
  });
  const req = await createEmergencyRequest({
    blood_group: 'A_NEGATIVE',
    resource_type: 'PLASMA',
    quantity: 1,
    status: 'OPEN'
  });

  const { data: offer } = await client.from('blood_bank_transfer_offers').insert({
    request_id: req.id,
    blood_bank_id: BLOOD_BANK_B_ID,
    blood_group: 'A_NEGATIVE',
    component_type: 'PLASMA',
    offered_units: 1,
    status: 'OFFERED'
  }).select().single();

  const { error: firstErr } = await client.rpc('accept_blood_bank_transfer_offer', {
    p_offer_id: offer.id,
    p_blood_bank_id: BLOOD_BANK_B_ID
  });
  assert.equal(firstErr, null);

  const { error: secondErr } = await client.rpc('accept_blood_bank_transfer_offer', {
    p_offer_id: offer.id,
    p_blood_bank_id: BLOOD_BANK_B_ID
  });
  assert.ok(secondErr);
  assert.equal(secondErr.code, '55000');
});

// ============================================================================
// PART 4: RESOURCE DOUBLE-COUNTING PROTECTION & FULFILMENT ISOLATION
// ============================================================================

test('DOUBLE-COUNTING PROTECTION: Donor dispatch lifecycle does NOT inflate fulfilled quantity or request status', async () => {
  // Use distinct blood group for isolated test lot
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'AB_NEGATIVE',
    component_type: 'WHOLE_BLOOD',
    available_units: 2,
    reserved_units: 0
  });
  const req = await createEmergencyRequest({
    blood_group: 'AB_NEGATIVE',
    resource_type: 'WHOLE_BLOOD',
    quantity: 4,
    status: 'OPEN'
  });

  // 1. Reserve available 2 units from inventory
  await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'AB_NEGATIVE',
    p_component_type: 'WHOLE_BLOOD',
    p_quantity: 4
  });

  const { data: allocsInitial } = await client.from('request_inventory_allocations').select('allocated_units').eq('request_id', req.id);
  const initialUnits = allocsInitial.reduce((sum, a) => sum + a.allocated_units, 0);
  assert.equal(initialUnits, 2);

  const { data: reqInitial } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqInitial.status, 'PARTIALLY_FULFILLED');

  // 2. Dispatch a donor for remaining capacity
  const user = await createTestUser('double_count_donor');
  const donor = await createTestDonor(user, { blood_group: 'AB_NEGATIVE' });
  const dispatch = await createTestDispatch(req.id, donor.id);

  const { data: reqAfterDispatch } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqAfterDispatch.status, 'PARTIALLY_FULFILLED');

  // 3. Donor accepts dispatch
  const { data: acceptRes, error: accErr } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.equal(accErr, null);
  assert.equal(acceptRes[0].dispatch_status, 'ACCEPTED');
  assert.equal(acceptRes[0].request_status, 'PARTIALLY_FULFILLED');

  const { data: allocsAfterAccept } = await client.from('request_inventory_allocations').select('allocated_units').eq('request_id', req.id);
  const acceptUnits = allocsAfterAccept.reduce((sum, a) => sum + a.allocated_units, 0);
  assert.equal(acceptUnits, 2, 'Donor acceptance must NOT increase fulfilled unit count');

  // 4. Progress donor through EN_ROUTE and ARRIVED to COMPLETED
  await client.from('donor_dispatches').update({ status: 'EN_ROUTE', en_route_at: new Date().toISOString() }).eq('id', dispatch.id);
  await client.from('donor_dispatches').update({ status: 'ARRIVED', arrived_at: new Date().toISOString() }).eq('id', dispatch.id);
  await client.from('donor_dispatches').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', dispatch.id);

  const { data: reqAfterComplete } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqAfterComplete.status, 'PARTIALLY_FULFILLED');
  assert.equal(reqAfterComplete.completed_at, null);

  const { data: allocsFinal } = await client.from('request_inventory_allocations').select('allocated_units').eq('request_id', req.id);
  const finalUnits = allocsFinal.reduce((sum, a) => sum + a.allocated_units, 0);
  assert.equal(finalUnits, 2, 'Fulfilled units remain strictly the 2 units allocated from inventory');
});

// ============================================================================
// PART 5: MIXED RESOURCE COORDINATION & SURPLUS DISPATCH RELEASE
// ============================================================================

test('MIXED COORDINATION: Additional inventory arrives while donors are active; surplus dispatches safely released', async () => {
  const req = await createEmergencyRequest({
    blood_group: 'B_POSITIVE',
    resource_type: 'WHOLE_BLOOD',
    quantity: 2,
    status: 'OPEN'
  });

  const user1 = await createTestUser('mixed_donor_1');
  const donor1 = await createTestDonor(user1, { blood_group: 'B_POSITIVE' });
  const disp1 = await createTestDispatch(req.id, donor1.id);
  await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp1.id, p_donor_user_id: user1.id, p_response: 'ACCEPT' });

  const { data: reqBeforeInv } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqBeforeInv.status, 'OPEN');

  // Inventory arrives and is reserved
  await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'B_POSITIVE',
    component_type: 'WHOLE_BLOOD',
    available_units: 5,
    reserved_units: 0
  });

  const { data: resData } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'B_POSITIVE',
    p_component_type: 'WHOLE_BLOOD',
    p_quantity: 2
  });
  assert.equal(resData[0].remaining_request_units, 0);

  const { data: reqAfterInv } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqAfterInv.status, 'FULFILLED');

  // Releasing surplus dispatch preserves FULFILLED status
  const { data: relData, error: relErr } = await client.rpc('release_donor_dispatch', {
    p_dispatch_id: disp1.id,
    p_actor_user_id: user1.id,
    p_reason: 'REQUEST_FULFILLED'
  });
  assert.equal(relErr, null);
  assert.equal(relData[0].dispatch_status, 'CANCELLED');
  assert.equal(relData[0].request_status, 'FULFILLED');

  const { data: reqFinal } = await client.from('emergency_requests').select().eq('id', req.id).single();
  assert.equal(reqFinal.status, 'FULFILLED');
});

// ============================================================================
// PART 6: CANCELLATION CLEANUP (INVENTORY + PEER TRANSFER + DONOR DISPATCH)
// ============================================================================

test('CANCELLATION: Hospital request cancellation releases inventory back to stock, expires offers, and cancels dispatches', async () => {
  const req = await createEmergencyRequest({
    blood_group: 'O_NEGATIVE',
    resource_type: 'RED_BLOOD_CELLS',
    quantity: 2,
    status: 'OPEN'
  });

  // 1. Reserve 1 unit from inventory
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'O_NEGATIVE',
    component_type: 'RED_BLOOD_CELLS',
    available_units: 5,
    reserved_units: 0
  });
  await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'O_NEGATIVE',
    p_component_type: 'RED_BLOOD_CELLS',
    p_quantity: 1
  });

  const { data: invBefore } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(invBefore.available_units, 4);
  assert.equal(invBefore.reserved_units, 1);

  // 2. Peer transfer offer
  const { data: offer } = await client.from('blood_bank_transfer_offers').insert({
    request_id: req.id,
    blood_bank_id: BLOOD_BANK_B_ID,
    blood_group: 'O_NEGATIVE',
    component_type: 'RED_BLOOD_CELLS',
    offered_units: 1,
    status: 'OFFERED'
  }).select().single();

  // 3. Donor dispatch
  const user = await createTestUser('cancel_cleanup_donor');
  const donor = await createTestDonor(user, { blood_group: 'O_NEGATIVE' });
  const disp = await createTestDispatch(req.id, donor.id);
  await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp.id, p_donor_user_id: user.id, p_response: 'ACCEPT' });

  // 4. Cancel request
  const hospUser = await createTestUser('cancel_hosp_actor', 'HOSPITAL');
  const { data: cancelRes, error: cancelErr } = await client.rpc('cancel_emergency_request', {
    p_request_id: req.id,
    p_actor_user_id: hospUser.id
  });
  assert.equal(cancelErr, null);
  assert.equal(cancelRes[0].request_status, 'CANCELLED');
  assert.equal(cancelRes[0].released_dispatch_count, 1);
  assert.equal(cancelRes[0].released_inventory_units, 1);

  // Verify inventory restored
  const { data: invAfter } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(invAfter.available_units, 5);
  assert.equal(invAfter.reserved_units, 0);

  // Verify allocation marked RELEASED
  const { data: allocAfter } = await client.from('request_inventory_allocations').select().eq('request_id', req.id).single();
  assert.equal(allocAfter.status, 'RELEASED');
  assert.ok(allocAfter.released_at);

  // Verify offer cancelled
  const { data: offerAfter } = await client.from('blood_bank_transfer_offers').select().eq('id', offer.id).single();
  assert.equal(offerAfter.status, 'CANCELLED');

  // Verify dispatch cancelled
  const { data: dispAfter } = await client.from('donor_dispatches').select().eq('id', disp.id).single();
  assert.equal(dispAfter.status, 'CANCELLED');
  assert.equal(dispAfter.cancellation_reason, 'REQUEST_CANCELLED');

  // Verify donor intact
  const { data: donorAfter } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(donorAfter.eligibility_status, 'ELIGIBLE');
  assert.equal(donorAfter.availability_status, 'AVAILABLE');
});

// ============================================================================
// PART 7: EXPIRY CLEANUP
// ============================================================================

test('EXPIRY: expire_emergency_request safely releases inventory and active dispatches', async () => {
  const req = await createEmergencyRequest({
    blood_group: 'AB_POSITIVE',
    resource_type: 'WHOLE_BLOOD',
    quantity: 4,
    status: 'OPEN'
  });

  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'AB_POSITIVE',
    component_type: 'WHOLE_BLOOD',
    available_units: 3,
    reserved_units: 0
  });

  // Reserve 1 unit out of 4 (request is PARTIALLY_FULFILLED)
  await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'AB_POSITIVE',
    p_component_type: 'WHOLE_BLOOD',
    p_quantity: 1
  });

  const user = await createTestUser('expire_cleanup_donor');
  const donor = await createTestDonor(user, { blood_group: 'AB_POSITIVE' });
  const disp = await createTestDispatch(req.id, donor.id);
  await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp.id, p_donor_user_id: user.id, p_response: 'ACCEPT' });

  const { data: expireRes, error: expireErr } = await client.rpc('expire_emergency_request', {
    p_request_id: req.id,
    p_actor_user_id: null
  });
  assert.equal(expireErr, null);
  assert.equal(expireRes[0].request_status, 'EXPIRED');
  assert.equal(expireRes[0].released_dispatch_count, 1);
  assert.equal(expireRes[0].released_inventory_units, 1);

  const { data: invAfter } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(invAfter.available_units, 3);
  assert.equal(invAfter.reserved_units, 0);

  const { data: dispAfter } = await client.from('donor_dispatches').select().eq('id', disp.id).single();
  assert.equal(dispAfter.status, 'CANCELLED');
  assert.equal(dispAfter.cancellation_reason, 'REQUEST_EXPIRED');

  const { data: donorAfter } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(donorAfter.eligibility_status, 'ELIGIBLE');
});

// ============================================================================
// PART 8: IDEMPOTENCY SUITE
// ============================================================================

test('IDEMPOTENCY: Repeated operations return existing state without duplicate mutations', async () => {
  // 1. Repeated reservation on already fulfilled request throws 55000 deterministically
  await createTestInventory(BLOOD_BANK_A_ID, { blood_group: 'A_POSITIVE', component_type: 'PLASMA', available_units: 5 });
  const req = await createEmergencyRequest({ blood_group: 'A_POSITIVE', resource_type: 'PLASMA', quantity: 1, status: 'OPEN' });

  await client.rpc('reserve_blood_inventory', { p_request_id: req.id, p_blood_group: 'A_POSITIVE', p_component_type: 'PLASMA', p_quantity: 1 });
  const { error: repResErr } = await client.rpc('reserve_blood_inventory', { p_request_id: req.id, p_blood_group: 'A_POSITIVE', p_component_type: 'PLASMA', p_quantity: 1 });
  assert.ok(repResErr);
  assert.equal(repResErr.code, '55000');

  const { data: allocs } = await client.from('request_inventory_allocations').select().eq('request_id', req.id);
  assert.equal(allocs.length, 1);

  // 2. Repeated donor acceptance on same dispatch
  const user = await createTestUser('idempotent_donor');
  const donor = await createTestDonor(user);
  const req2 = await createEmergencyRequest({ quantity: 2 });
  const disp = await createTestDispatch(req2.id, donor.id);

  const { data: acc1 } = await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp.id, p_donor_user_id: user.id, p_response: 'ACCEPT' });
  assert.equal(acc1[0].is_already_responded, false);

  const { data: acc2 } = await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp.id, p_donor_user_id: user.id, p_response: 'ACCEPT' });
  assert.equal(acc2[0].is_already_responded, true);

  // 3. Repeated dispatch release
  const { data: rel1 } = await client.rpc('release_donor_dispatch', { p_dispatch_id: disp.id, p_actor_user_id: user.id, p_reason: 'GPS_TIMEOUT' });
  assert.equal(rel1[0].dispatch_status, 'CANCELLED');

  const { data: rel2 } = await client.rpc('release_donor_dispatch', { p_dispatch_id: disp.id, p_actor_user_id: user.id, p_reason: 'GPS_TIMEOUT' });
  assert.equal(rel2[0].dispatch_status, 'CANCELLED');

  // 4. Repeated request cancellation
  const hospUser = await createTestUser('idemp_hosp', 'HOSPITAL');
  const { data: can1 } = await client.rpc('cancel_emergency_request', { p_request_id: req2.id, p_actor_user_id: hospUser.id });
  assert.equal(can1[0].request_status, 'CANCELLED');

  const { data: can2 } = await client.rpc('cancel_emergency_request', { p_request_id: req2.id, p_actor_user_id: hospUser.id });
  assert.equal(can2[0].request_status, 'CANCELLED');
  assert.equal(can2[0].released_dispatch_count, 0);
});

// ============================================================================
// PART 9: REAL POSTGRESQL CONCURRENCY
// ============================================================================

test('CONCURRENCY: Competing inventory reservations on scarce stock never result in overselling or negative inventory', async () => {
  // Isolate with PLATELETS lot
  const inv = await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'O_NEGATIVE',
    component_type: 'PLATELETS',
    available_units: 3,
    reserved_units: 0
  });

  const req1 = await createEmergencyRequest({ blood_group: 'O_NEGATIVE', resource_type: 'PLATELETS', quantity: 2 });
  const req2 = await createEmergencyRequest({ blood_group: 'O_NEGATIVE', resource_type: 'PLATELETS', quantity: 2 });

  const [res1, res2] = await Promise.allSettled([
    client.rpc('reserve_blood_inventory', { p_request_id: req1.id, p_blood_group: 'O_NEGATIVE', p_component_type: 'PLATELETS', p_quantity: 2 }),
    client.rpc('reserve_blood_inventory', { p_request_id: req2.id, p_blood_group: 'O_NEGATIVE', p_component_type: 'PLATELETS', p_quantity: 2 })
  ]);

  assert.equal(res1.status, 'fulfilled');
  assert.equal(res2.status, 'fulfilled');

  const err1 = res1.value?.error ?? null;
  const err2 = res2.value?.error ?? null;

  for (const [idx, err] of [[1, err1], [2, err2]]) {
    if (err !== null) {
      const isExpectedConflict = ['40001', '55000', '40P01'].includes(err.code) ||
        /conflict|serialization|insufficient|deadlock/i.test(err.message || '');
      assert.ok(isExpectedConflict, `RPC ${idx} returned unexpected error: ${JSON.stringify(err)}`);
    } else {
      assert.equal(err, null);
    }
  }

  const { data: finalInv } = await client.from('blood_inventory').select().eq('id', inv.id).single();
  assert.equal(finalInv.available_units, 0);
  assert.equal(finalInv.reserved_units, 3);
  assert.ok(finalInv.available_units >= 0);

  const { data: allocs1 } = await client.from('request_inventory_allocations').select('allocated_units').eq('request_id', req1.id);
  const { data: allocs2 } = await client.from('request_inventory_allocations').select('allocated_units').eq('request_id', req2.id);
  const totalAllocated = (allocs1 || []).reduce((s, a) => s + a.allocated_units, 0) +
                         (allocs2 || []).reduce((s, a) => s + a.allocated_units, 0);
  assert.equal(totalAllocated, 3);
});

// ============================================================================
// PART 10: AUDIT LOGS & NOTIFICATIONS INTEGRITY
// ============================================================================

test('AUDIT & PRIVACY: State transitions record structured audit logs without sensitive patient or GPS data', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'OPEN' });
  const hospUser = await createTestUser('audit_hosp', 'HOSPITAL');

  const { data: cancelRes, error: cancelErr } = await client.rpc('cancel_emergency_request', {
    p_request_id: req.id,
    p_actor_user_id: hospUser.id
  });
  assert.equal(cancelErr, null);
  assert.equal(cancelRes[0].request_status, 'CANCELLED');

  const { data: auditLog } = await client
    .from('audit_logs')
    .select('*')
    .eq('action', 'EMERGENCY_REQUEST_CANCELLED')
    .eq('entity_id', req.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  assert.ok(auditLog);
  assert.equal(auditLog.entity_type, 'emergency_request');
  assert.equal(auditLog.actor_user_id, hospUser.id);

  const jsonStr = JSON.stringify(auditLog);
  assert.equal(jsonStr.includes('patient'), false);
  assert.equal(jsonStr.includes('diagnosis'), false);
  assert.equal(jsonStr.includes('latitude'), false);
  assert.equal(jsonStr.includes('longitude'), false);
});

// ============================================================================
// FAILURE PATHS A THROUGH N
// ============================================================================

test('FAILURE PATH A: Insufficient inventory reserves available and leaves remaining needed', async () => {
  await createTestInventory(BLOOD_BANK_A_ID, {
    blood_group: 'B_NEGATIVE',
    component_type: 'PLASMA',
    available_units: 1,
    reserved_units: 0
  });
  const req = await createEmergencyRequest({
    blood_group: 'B_NEGATIVE',
    resource_type: 'PLASMA',
    quantity: 3,
    status: 'OPEN'
  });

  const { data } = await client.rpc('reserve_blood_inventory', {
    p_request_id: req.id,
    p_blood_group: 'B_NEGATIVE',
    p_component_type: 'PLASMA',
    p_quantity: 3
  });
  assert.equal(data.length, 1);
  assert.equal(data[0].allocated_units, 1);
  assert.equal(data[0].remaining_request_units, 2);
});

test('FAILURE PATH E: Donor acceptance after request fulfilment is rejected', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'FULFILLED', completed_at: new Date().toISOString() });
  const user = await createTestUser('after_fulfil_donor');
  const donor = await createTestDonor(user);
  const disp = await createTestDispatch(req.id, donor.id);

  const { error } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: disp.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.ok(error);
  assert.equal(error.code, '55000');
});

test('FAILURE PATH F: Donor acceptance after request cancellation is rejected', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'CANCELLED' });
  const user = await createTestUser('after_cancel_donor');
  const donor = await createTestDonor(user);
  const disp = await createTestDispatch(req.id, donor.id);

  const { error } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: disp.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.ok(error);
  assert.equal(error.code, '55000');
});

test('FAILURE PATH H: Request cancellation while donor is EN_ROUTE releases dispatch and preserves donor eligibility', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'OPEN' });
  const user = await createTestUser('en_route_cancel_donor');
  const donor = await createTestDonor(user);
  const disp = await createTestDispatch(req.id, donor.id);

  await client.rpc('respond_to_donor_dispatch', { p_dispatch_id: disp.id, p_donor_user_id: user.id, p_response: 'ACCEPT' });
  await client.from('donor_dispatches').update({ status: 'EN_ROUTE', en_route_at: new Date().toISOString() }).eq('id', disp.id);

  const hospUser = await createTestUser('hosp_cancel_actor_2', 'HOSPITAL');
  const { data: cancelRes, error: cancelErr } = await client.rpc('cancel_emergency_request', {
    p_request_id: req.id,
    p_actor_user_id: hospUser.id
  });
  assert.equal(cancelErr, null);
  assert.equal(cancelRes[0].request_status, 'CANCELLED');

  const { data: checkDisp } = await client.from('donor_dispatches').select().eq('id', disp.id).single();
  assert.equal(checkDisp.status, 'CANCELLED');
  assert.equal(checkDisp.cancellation_reason, 'REQUEST_CANCELLED');

  const { data: checkDonor } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(checkDonor.eligibility_status, 'ELIGIBLE');
  assert.equal(checkDonor.availability_status, 'AVAILABLE');
});

test('FAILURE PATH I: Cancellation while peer transfer is active safely cancels the transfer offer', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'OPEN' });
  const { data: offer } = await client.from('blood_bank_transfer_offers').insert({
    request_id: req.id,
    blood_bank_id: BLOOD_BANK_B_ID,
    blood_group: 'O_POSITIVE',
    component_type: 'WHOLE_BLOOD',
    offered_units: 1,
    status: 'OFFERED'
  }).select().single();

  const hospUser = await createTestUser('hosp_cancel_actor_3', 'HOSPITAL');
  await client.rpc('cancel_emergency_request', { p_request_id: req.id, p_actor_user_id: hospUser.id });

  const { data: checkOffer } = await client.from('blood_bank_transfer_offers').select().eq('id', offer.id).single();
  assert.equal(checkOffer.status, 'CANCELLED');
});

test('FAILURE PATH L: Invalid request state transitions are blocked by trigger', async () => {
  const req = await createEmergencyRequest({ quantity: 1, status: 'FULFILLED', completed_at: new Date().toISOString() });

  const { error } = await client.from('emergency_requests').update({ status: 'PARTIALLY_FULFILLED' }).eq('id', req.id);
  assert.ok(error);
  assert.equal(error.code, '55000');
});
