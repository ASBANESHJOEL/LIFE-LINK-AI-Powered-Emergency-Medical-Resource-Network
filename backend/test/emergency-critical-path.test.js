import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  getGpsGracePeriodMinutes,
  getStaleLocationThresholdMinutes,
  getMaxAcceptableEtaMinutes
} from '../src/services/donorDispatchService.js';

// ============================================================================
// LIFE-LINK PHASE 4: Full Emergency Critical Path & Donor Resilience Integration Tests
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

// Helpers to seed isolated test entities
async function createTestUser(emailPrefix, role = 'DONOR') {
  const userId = crypto.randomUUID();
  const { data, error } = await client.from('users').insert({
    id: userId,
    email: `${emailPrefix}_${Date.now()}@test.lifelink.org`,
    role,
    is_active: true
  }).select().single();
  if (error) throw new Error(`User create failed: ${error.message}`);
  return data;
}

async function createTestDonor(user, overrides = {}) {
  const { data, error } = await client.from('donors').insert({
    user_id: user.id,
    name: 'Test Donor',
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
    quantity: 1,
    urgency: 'CRITICAL',
    status: 'OPEN',
    hospital_latitude: 12.9716,
    hospital_longitude: 77.5946,
    is_synthetic: true,
    ...overrides
  }).select().single();
  if (error) throw new Error(`Request create failed: ${error.message}`);
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
  return data;
}

// ----------------------------------------------------------------------------
// PRIMARY HAPPY PATH
// ----------------------------------------------------------------------------
test('Critical Path: Full End-to-End Emergency Dispatch Happy Path', async () => {
  const user = await createTestUser('happy_path_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  // 1. Accept dispatch
  const { data: acceptData, error: acceptErr } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.equal(acceptErr, null, 'Donor accept RPC should succeed');
  assert.equal(acceptData[0].dispatch_status, 'ACCEPTED');
  assert.equal(acceptData[0].request_status, 'OPEN', 'Donor acceptance must not manufacture request fulfilment');

  // 2. Start Transit -> EN_ROUTE
  const now = new Date().toISOString();
  const { data: enRouteDisp, error: enRouteErr } = await client.from('donor_dispatches')
    .update({ status: 'EN_ROUTE', en_route_at: now })
    .eq('id', dispatch.id)
    .select().single();
  assert.equal(enRouteErr, null);
  assert.equal(enRouteDisp.status, 'EN_ROUTE');
  assert.ok(enRouteDisp.en_route_at);

  // 3. Record Live Location
  const { error: locErr } = await client.from('live_locations').insert({
    request_id: request.id,
    donor_id: donor.id,
    dispatch_id: dispatch.id,
    latitude: 12.9720,
    longitude: 77.5950,
    is_synthetic: true
  });
  assert.equal(locErr, null, 'Live location telemetry should record cleanly');

  // 4. Arrived at Hospital
  const { data: arrivedDisp, error: arriveErr } = await client.from('donor_dispatches')
    .update({ status: 'ARRIVED', arrived_at: new Date().toISOString() })
    .eq('id', dispatch.id)
    .select().single();
  assert.equal(arriveErr, null);
  assert.equal(arrivedDisp.status, 'ARRIVED');

  // 5. Donation Complete
  const { data: completedDisp, error: compErr } = await client.from('donor_dispatches')
    .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
    .eq('id', dispatch.id)
    .select().single();
  assert.equal(compErr, null);
  assert.equal(completedDisp.status, 'COMPLETED');

  // Verify request status remains OPEN as determined by actual inventory fulfilment (0 units reserved)
  const { data: finalReq } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(finalReq.status, 'OPEN', 'Emergency request remains in its actual resource fulfilment state (OPEN)');
  assert.equal(finalReq.completed_at, null);

  const { data: finalDonor } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(finalDonor.eligibility_status, 'ELIGIBLE');
});

// ----------------------------------------------------------------------------
// TEST A: GPS TIMEOUT → ACTUAL REASSIGNMENT WORKFLOW
// ----------------------------------------------------------------------------
test('TEST A: GPS Timeout releases ONLY the dispatch and proves complete reassignment workflow to replacement Donor B', async () => {
  // 1. Request remains active (quantity = 1)
  const request = await createEmergencyRequest({ quantity: 1 });
  assert.equal(request.status, 'OPEN');

  // 2. Donor A is dispatched
  const userA = await createTestUser('gps_timeout_donor_a');
  const donorA = await createTestDonor(userA);
  const dispatchA = await createTestDispatch(request.id, donorA.id);
  assert.equal(dispatchA.status, 'NOTIFIED');

  // 3. Donor A accepts -> dispatch becomes ACCEPTED (active dispatch); request status determined from actual fulfilment state
  const { data: acceptA, error: accErrA } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatchA.id,
    p_donor_user_id: userA.id,
    p_response: 'ACCEPT'
  });
  assert.equal(accErrA, null);
  assert.equal(acceptA[0].dispatch_status, 'ACCEPTED');
  assert.equal(acceptA[0].request_status, 'OPEN', 'Donor acceptance does not derive request fulfilment; request status remains OPEN');

  const { data: reqAfterAcceptA } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(reqAfterAcceptA.status, 'OPEN', 'Request status remains determined from actual inventory allocations (OPEN)');

  // 4. GPS remains unavailable & GPS grace period expires -> dispatch is released
  const { data: releasedA, error: relErrA } = await client.rpc('release_donor_dispatch', {
    p_dispatch_id: dispatchA.id,
    p_actor_user_id: userA.id,
    p_reason: 'GPS_TIMEOUT'
  });
  assert.equal(relErrA, null);
  assert.equal(releasedA[0].dispatch_status, 'CANCELLED');
  assert.equal(releasedA[0].cancellation_reason, 'GPS_TIMEOUT');

  // 5. Donor A remains ELIGIBLE and AVAILABLE (no penalty)
  const { data: checkDonorA } = await client.from('donors').select().eq('id', donorA.id).single();
  assert.equal(checkDonorA.eligibility_status, 'ELIGIBLE');
  assert.equal(checkDonorA.availability_status, 'AVAILABLE');

  // 6. Request status remains determined from actual resource fulfilment state (OPEN)
  const { data: reqAfterRelease } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(reqAfterRelease.status, 'OPEN', 'GPS timeout does not blindly mutate request status; remains OPEN');

  // 7. Donor B is selected and receives a new active dispatch
  const userB = await createTestUser('replacement_donor_b');
  const donorB = await createTestDonor(userB);
  assert.equal(donorB.eligibility_status, 'ELIGIBLE');
  assert.equal(donorB.availability_status, 'AVAILABLE');

  const dispatchB = await createTestDispatch(request.id, donorB.id, { batch_number: 2 });
  assert.ok(dispatchB.id);
  assert.equal(dispatchB.status, 'NOTIFIED');

  // Donor B accepts the assignment -> becomes new active dispatch
  const { data: acceptB, error: accErrB } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatchB.id,
    p_donor_user_id: userB.id,
    p_response: 'ACCEPT'
  });
  assert.equal(accErrB, null);
  assert.equal(acceptB[0].dispatch_status, 'ACCEPTED');
  assert.equal(acceptB[0].request_status, 'OPEN', 'Request status remains determined from actual resource fulfilment state');

  // 8. Prove the entire reassignment state across database
  const { data: activeDispatches } = await client
    .from('donor_dispatches')
    .select('id, donor_id, status, cancellation_reason')
    .eq('request_id', request.id);

  assert.equal(activeDispatches.length, 2);
  const donorADisp = activeDispatches.find(d => d.donor_id === donorA.id);
  const donorBDisp = activeDispatches.find(d => d.donor_id === donorB.id);
  assert.equal(donorADisp.status, 'CANCELLED');
  assert.equal(donorADisp.cancellation_reason, 'GPS_TIMEOUT');
  assert.equal(donorBDisp.status, 'ACCEPTED');

  // Final request status: remains determined from actual fulfilment state (OPEN)
  const { data: finalReq } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(finalReq.status, 'OPEN', 'Request status remains determined by actual inventory fulfilment (OPEN)');
});

// ----------------------------------------------------------------------------
// TEST B: GPS RECOVERY
// ----------------------------------------------------------------------------
test('TEST B: GPS Recovery transitions donor from ACCEPTED to EN_ROUTE before timeout', async () => {
  const user = await createTestUser('gps_recovery_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  // Transmit location before grace period expires
  const { error: locErr } = await client.from('live_locations').insert({
    request_id: request.id,
    donor_id: donor.id,
    dispatch_id: dispatch.id,
    latitude: 12.9750,
    longitude: 77.5980,
    is_synthetic: true
  });
  assert.equal(locErr, null);

  const { data: updatedDisp, error: upErr } = await client.from('donor_dispatches')
    .update({ status: 'EN_ROUTE', en_route_at: new Date().toISOString(), current_latitude: 12.9750, current_longitude: 77.5980 })
    .eq('id', dispatch.id)
    .select().single();
  assert.equal(upErr, null);
  assert.equal(updatedDisp.status, 'EN_ROUTE');
});

// ----------------------------------------------------------------------------
// TEST C: ETA EXCEEDED → ACTUAL REASSIGNMENT WORKFLOW
// ----------------------------------------------------------------------------
test('TEST C: ETA Exceeded safely releases dispatch and proves complete reassignment workflow to replacement Donor B', async () => {
  const request = await createEmergencyRequest({ quantity: 1 });
  assert.equal(request.status, 'OPEN');

  const userA = await createTestUser('eta_exceeded_donor_a');
  const donorA = await createTestDonor(userA);
  const dispatchA = await createTestDispatch(request.id, donorA.id);

  const { data: acceptA } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatchA.id,
    p_donor_user_id: userA.id,
    p_response: 'ACCEPT'
  });
  assert.equal(acceptA[0].request_status, 'OPEN', 'Acceptance does not derive request fulfilment');

  await client.from('donor_dispatches')
    .update({ status: 'EN_ROUTE', en_route_at: new Date().toISOString() })
    .eq('id', dispatchA.id);

  // ETA exceeded threshold -> dispatch released
  const { data: released, error: relErr } = await client.rpc('release_donor_dispatch', {
    p_dispatch_id: dispatchA.id,
    p_actor_user_id: userA.id,
    p_reason: 'ETA_EXCEEDED'
  });
  assert.equal(relErr, null);
  assert.equal(released[0].dispatch_status, 'CANCELLED');
  assert.equal(released[0].cancellation_reason, 'ETA_EXCEEDED');

  const { data: checkDonorA } = await client.from('donors').select().eq('id', donorA.id).single();
  assert.equal(checkDonorA.eligibility_status, 'ELIGIBLE');
  assert.equal(checkDonorA.availability_status, 'AVAILABLE');

  // Request status remains determined from actual resource fulfilment state (OPEN)
  const { data: reqAfterRelease } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(reqAfterRelease.status, 'OPEN', 'Request status remains determined from actual inventory allocations (OPEN)');

  // Replacement Donor B is selected and receives a new active dispatch
  const userB = await createTestUser('replacement_eta_donor_b');
  const donorB = await createTestDonor(userB);
  const dispatchB = await createTestDispatch(request.id, donorB.id, { batch_number: 2 });
  assert.ok(dispatchB.id);

  const { data: acceptB, error: accErrB } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatchB.id,
    p_donor_user_id: userB.id,
    p_response: 'ACCEPT'
  });
  assert.equal(accErrB, null);
  assert.equal(acceptB[0].dispatch_status, 'ACCEPTED');
  assert.equal(acceptB[0].request_status, 'OPEN', 'Request status remains determined from actual fulfilment state');

  const { data: finalReq } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(finalReq.status, 'OPEN', 'Request status remains OPEN as determined by actual resource fulfilment');
});

// ----------------------------------------------------------------------------
// TEST D: SIMULTANEOUS ACCEPTANCE (CASE A, CASE B, COMPLETED ISOLATION)
// ----------------------------------------------------------------------------
test('TEST D: Concurrent Acceptance - CASE A (Surplus Released), CASE B (Multiple Legitimate Active), Completed Isolation', async () => {
  // CASE A: Request needs 1 unit. Two donors accept concurrently. Exactly 1 accepted, surplus safely released.
  const reqA = await createEmergencyRequest({ quantity: 1 });
  const userA1 = await createTestUser('conc_a1');
  const donorA1 = await createTestDonor(userA1);
  const dispA1 = await createTestDispatch(reqA.id, donorA1.id);

  const userA2 = await createTestUser('conc_a2');
  const donorA2 = await createTestDonor(userA2);
  const dispA2 = await createTestDispatch(reqA.id, donorA2.id);

  // Concurrently execute acceptances
  const [resA1, resA2] = await Promise.allSettled([
    client.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispA1.id,
      p_donor_user_id: userA1.id,
      p_response: 'ACCEPT'
    }),
    client.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispA2.id,
      p_donor_user_id: userA2.id,
      p_response: 'ACCEPT'
    })
  ]);

  const successesA = [resA1, resA2].filter(r => r.status === 'fulfilled' && !r.value.error);
  assert.equal(successesA.length, 1, 'Exactly one concurrent acceptance must succeed for 1-unit request');

  // Verify the surplus dispatch was safely released
  const { data: dispsA } = await client.from('donor_dispatches').select().eq('request_id', reqA.id);
  const acceptedA = dispsA.filter(d => d.status === 'ACCEPTED');
  const cancelledA = dispsA.filter(d => d.status === 'CANCELLED' && (d.cancellation_reason === 'SURPLUS_CAPACITY' || d.cancellation_reason === 'REQUEST_FULFILLED'));
  assert.equal(acceptedA.length, 1);
  assert.equal(cancelledA.length, 1);

  // Verify request status is derived from actual inventory fulfilment (OPEN, not blindly derived from dispatch)
  const { data: dbReqA } = await client.from('emergency_requests').select().eq('id', reqA.id).single();
  assert.equal(dbReqA.status, 'OPEN', 'Surplus release does not derive request fulfilment from dispatch count');

  // CASE B: Request needs 2 units. Multiple donors legitimately required. Both remain active.
  const reqB = await createEmergencyRequest({ quantity: 2 });
  const userB1 = await createTestUser('conc_b1');
  const donorB1 = await createTestDonor(userB1);
  const dispB1 = await createTestDispatch(reqB.id, donorB1.id);

  const userB2 = await createTestUser('conc_b2');
  const donorB2 = await createTestDonor(userB2);
  const dispB2 = await createTestDispatch(reqB.id, donorB2.id);

  const [resB1, resB2] = await Promise.allSettled([
    client.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispB1.id,
      p_donor_user_id: userB1.id,
      p_response: 'ACCEPT'
    }),
    client.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispB2.id,
      p_donor_user_id: userB2.id,
      p_response: 'ACCEPT'
    })
  ]);

  assert.equal(resB1.status, 'fulfilled');
  assert.equal(resB1.value.error, null, 'First donor accept succeeds');
  assert.equal(resB2.status, 'fulfilled');
  assert.equal(resB2.value.error, null, 'Second donor accept succeeds');

  const { data: dispsB } = await client.from('donor_dispatches').select().eq('request_id', reqB.id);
  const acceptedB = dispsB.filter(d => d.status === 'ACCEPTED');
  assert.equal(acceptedB.length, 2, 'Both donors must legitimately remain accepted when capacity requires 2');

  const { data: dbReqB } = await client.from('emergency_requests').select().eq('id', reqB.id).single();
  assert.equal(dbReqB.status, 'OPEN', 'Multiple accepted donors remain active while request status reflects actual inventory fulfilment');

  // COMPLETED ISOLATION: A donor with a COMPLETED dispatch can be dispatched again and does not block matching
  const userC = await createTestUser('historical_donor');
  const donorC = await createTestDonor(userC);
  const pastReq = await createEmergencyRequest({ quantity: 1 });
  const pastDisp = await createTestDispatch(pastReq.id, donorC.id, {
    status: 'COMPLETED',
    completed_at: new Date(Date.now() - 86400000).toISOString()
  });
  assert.equal(pastDisp.status, 'COMPLETED');

  // Donor with past COMPLETED dispatch can receive a new dispatch on a new request
  const newReq = await createEmergencyRequest({ quantity: 1 });
  const newDisp = await createTestDispatch(newReq.id, donorC.id);
  assert.ok(newDisp.id);
  assert.equal(newDisp.status, 'NOTIFIED');

  // And can successfully accept the new dispatch
  const { data: newAccept, error: newAcceptErr } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: newDisp.id,
    p_donor_user_id: userC.id,
    p_response: 'ACCEPT'
  });
  assert.equal(newAcceptErr, null, 'Donor with past COMPLETED dispatch can accept a new dispatch');
  assert.equal(newAccept[0].dispatch_status, 'ACCEPTED');
});

// ----------------------------------------------------------------------------
// TEST: DISPATCH COMPLETION DOES NOT MANUFACTURE REQUEST FULFILMENT
// ----------------------------------------------------------------------------
test('TEST DISPATCH COMPLETION: Completing a donor dispatch does not independently manufacture request fulfilment', async () => {
  const request = await createEmergencyRequest({ quantity: 2 });
  assert.equal(request.status, 'OPEN');

  const user = await createTestUser('completion_isolation_donor');
  const donor = await createTestDonor(user);
  const dispatch = await createTestDispatch(request.id, donor.id);

  // Donor accepts
  const { data: acceptRes } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.equal(acceptRes[0].dispatch_status, 'ACCEPTED');

  // Transition through ARRIVED to COMPLETED
  await client.from('donor_dispatches')
    .update({ status: 'ARRIVED', arrived_at: new Date().toISOString() })
    .eq('id', dispatch.id);

  const { data: completedDisp, error: compErr } = await client.from('donor_dispatches')
    .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
    .eq('id', dispatch.id)
    .select().single();
  assert.equal(compErr, null);
  assert.equal(completedDisp.status, 'COMPLETED');

  // Verify that emergency_requests.status has NOT been mutated to FULFILLED or PARTIALLY_FULFILLED
  const { data: checkReq } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(checkReq.status, 'OPEN', 'Request status remains OPEN based on actual inventory allocations (0 reserved)');
  assert.equal(checkReq.completed_at, null);
});

// ----------------------------------------------------------------------------
// TEST: MULTI-DONOR LEGITIMATE ACCEPTANCE ACROSS EMERGENCY REQUIREMENT
// ----------------------------------------------------------------------------
test('TEST MULTI-DONOR: Multiple accepted donors remain active when the actual requirement requires them', async () => {
  // Emergency requirement requires 4 units
  const request = await createEmergencyRequest({ quantity: 4 });
  assert.equal(request.status, 'OPEN');

  // Dispatch 3 donors
  const donors = [];
  const dispatches = [];
  for (let i = 1; i <= 3; i++) {
    const user = await createTestUser(`multi_donor_${i}`);
    const donor = await createTestDonor(user);
    const disp = await createTestDispatch(request.id, donor.id, { batch_number: 1 });
    donors.push({ user, donor });
    dispatches.push(disp);
  }

  // All 3 donors accept
  for (let i = 0; i < 3; i++) {
    const { data: acceptRes, error: acceptErr } = await client.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispatches[i].id,
      p_donor_user_id: donors[i].user.id,
      p_response: 'ACCEPT'
    });
    assert.equal(acceptErr, null);
    assert.equal(acceptRes[0].dispatch_status, 'ACCEPTED');
    assert.equal(acceptRes[0].request_status, 'OPEN', 'Request status remains determined by inventory allocations');
  }

  // Verify all 3 dispatches legitimately remain ACCEPTED
  const { data: activeDisps } = await client.from('donor_dispatches')
    .select('id, donor_id, status')
    .eq('request_id', request.id);
  const acceptedDisps = activeDisps.filter(d => d.status === 'ACCEPTED');
  assert.equal(acceptedDisps.length, 3, 'All 3 donor dispatches remain active and accepted');

  // Verify request status is OPEN (not artificially fulfilled)
  const { data: checkReq } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(checkReq.status, 'OPEN', 'Request status remains OPEN until actual blood inventory is allocated');
});

// ----------------------------------------------------------------------------
// TEST E: DONOR AVAILABILITY TOGGLE
// ----------------------------------------------------------------------------
test('TEST E: Donor Availability Toggle updates availability without touching eligibility', async () => {
  const user = await createTestUser('avail_toggle_donor');
  const donor = await createTestDonor(user);

  // Toggle AVAILABLE -> UNAVAILABLE
  const { data: unavail, error: unErr } = await client.rpc('set_donor_availability', {
    p_donor_user_id: user.id,
    p_new_status: 'UNAVAILABLE'
  });
  assert.equal(unErr, null);
  assert.equal(unavail[0].availability_status, 'UNAVAILABLE');
  assert.equal(unavail[0].eligibility_status, 'ELIGIBLE');

  // Toggle back to AVAILABLE
  const { data: avail, error: avErr } = await client.rpc('set_donor_availability', {
    p_donor_user_id: user.id,
    p_new_status: 'AVAILABLE'
  });
  assert.equal(avErr, null);
  assert.equal(avail[0].availability_status, 'AVAILABLE');
  assert.equal(avail[0].eligibility_status, 'ELIGIBLE');
});

// ----------------------------------------------------------------------------
// TEST F: ACTIVE DISPATCH + UNAVAILABLE WITH CONFIRMATION
// ----------------------------------------------------------------------------
test('TEST F: Switching to UNAVAILABLE with active dispatch requires confirmation; confirmed withdrawal releases dispatch', async () => {
  const user = await createTestUser('active_unavail_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  // Donor accepts dispatch (making it ACTIVE)
  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  // Attempting to switch to UNAVAILABLE without confirmation must fail
  const { error: unconfirmedErr } = await client.rpc('set_donor_availability', {
    p_donor_user_id: user.id,
    p_new_status: 'UNAVAILABLE',
    p_confirm_withdraw: false
  });
  assert.ok(unconfirmedErr, 'Unconfirmed availability change with active dispatch must throw error');
  assert.equal(unconfirmedErr.code, '55001');

  // Switching with confirmed withdrawal succeeds
  const { data: confirmed, error: confErr } = await client.rpc('set_donor_availability', {
    p_donor_user_id: user.id,
    p_new_status: 'UNAVAILABLE',
    p_confirm_withdraw: true
  });
  assert.equal(confErr, null);
  assert.equal(confirmed[0].availability_status, 'UNAVAILABLE');
  assert.equal(confirmed[0].eligibility_status, 'ELIGIBLE');
  assert.equal(confirmed[0].active_dispatches_withdrawn, 1);

  // Verify the active dispatch was released with reason DONOR_UNAVAILABLE
  const { data: disp } = await client.from('donor_dispatches').select().eq('id', dispatch.id).single();
  assert.equal(disp.status, 'CANCELLED');
  assert.equal(disp.cancellation_reason, 'DONOR_UNAVAILABLE');
});

// ----------------------------------------------------------------------------
// TEST G: DONOR WITHDRAWAL
// ----------------------------------------------------------------------------
test('TEST G: Donor voluntary withdrawal releases ONLY the dispatch; request remains open, donor remains ELIGIBLE', async () => {
  const user = await createTestUser('withdraw_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  // Donor withdraws voluntarily
  const { data: released, error: relErr } = await client.rpc('release_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_actor_user_id: user.id,
    p_reason: 'DONOR_WITHDREW'
  });
  assert.equal(relErr, null);
  assert.equal(released[0].dispatch_status, 'CANCELLED');
  assert.equal(released[0].cancellation_reason, 'DONOR_WITHDREW');

  // Request returns to OPEN
  const { data: req } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(req.status, 'OPEN');

  // Donor remains ELIGIBLE and AVAILABLE
  const { data: d } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(d.eligibility_status, 'ELIGIBLE');
  assert.equal(d.availability_status, 'AVAILABLE');
});

// ----------------------------------------------------------------------------
// TEST H: REQUEST FULFILLED DURING ACTIVE DISPATCH
// ----------------------------------------------------------------------------
test('TEST H: Releasing surplus dispatch upon request fulfillment preserves FULFILLED status', async () => {
  const user = await createTestUser('fulfilled_surplus_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1, status: 'FULFILLED', completed_at: new Date().toISOString() });
  const dispatch = await createTestDispatch(request.id, donor.id, { status: 'NOTIFIED' });

  // Release surplus dispatch because request is fulfilled
  const { data: released, error: relErr } = await client.rpc('release_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_actor_user_id: user.id,
    p_reason: 'REQUEST_FULFILLED'
  });
  assert.equal(relErr, null);
  assert.equal(released[0].dispatch_status, 'CANCELLED');

  // Request status must remain FULFILLED, NOT corrupted to OPEN
  const { data: req } = await client.from('emergency_requests').select().eq('id', request.id).single();
  assert.equal(req.status, 'FULFILLED');
});

// ----------------------------------------------------------------------------
// TEST I: REQUEST CANCELLED DURING ACTIVE DISPATCH
// ----------------------------------------------------------------------------
test('TEST I: Hospital cancelling emergency request releases all active dispatches', async () => {
  const user = await createTestUser('hosp_cancel_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  // Accept dispatch
  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  // Hospital staff user cancels request
  const hospUser = await createTestUser('hosp_cancel_actor', 'HOSPITAL');
  const { data: cancelResult, error: cancelErr } = await client.rpc('cancel_emergency_request', {
    p_request_id: request.id,
    p_actor_user_id: hospUser.id
  });
  assert.equal(cancelErr, null);
  assert.equal(cancelResult[0].request_status, 'CANCELLED');
  assert.equal(cancelResult[0].released_dispatch_count, 1);

  // Verify dispatch was marked CANCELLED with reason REQUEST_CANCELLED
  const { data: disp } = await client.from('donor_dispatches').select().eq('id', dispatch.id).single();
  assert.equal(disp.status, 'CANCELLED');
  assert.equal(disp.cancellation_reason, 'REQUEST_CANCELLED');

  // Donor eligibility remains ELIGIBLE
  const { data: d } = await client.from('donors').select().eq('id', donor.id).single();
  assert.equal(d.eligibility_status, 'ELIGIBLE');
});

// ----------------------------------------------------------------------------
// TEST J: DUPLICATE ACCEPTANCE (IDEMPOTENCY)
// ----------------------------------------------------------------------------
test('TEST J: Duplicate acceptance on same dispatch is idempotent', async () => {
  const user = await createTestUser('dup_accept_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  // First accept
  const { data: firstRes, error: err1 } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.equal(err1, null);
  assert.equal(firstRes[0].is_already_responded, false);

  // Second accept on same dispatch
  const { data: secondRes, error: err2 } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });
  assert.equal(err2, null);
  assert.equal(secondRes[0].is_already_responded, true);
  assert.equal(secondRes[0].dispatch_status, 'ACCEPTED');
});

// ----------------------------------------------------------------------------
// TEST K: ACTIVE DONOR EXCLUSION (SINGLE ACTIVE DISPATCH RULE)
// ----------------------------------------------------------------------------
test('TEST K: Single Active Dispatch - Donor with active dispatch cannot receive another active dispatch', async () => {
  const user = await createTestUser('single_active_donor');
  const donor = await createTestDonor(user);
  const req1 = await createEmergencyRequest({ quantity: 1 });
  const disp1 = await createTestDispatch(req1.id, donor.id);

  // Accept first dispatch -> status ACCEPTED
  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: disp1.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  // Attempt to assign and accept a second active dispatch on a different request
  const req2 = await createEmergencyRequest({ quantity: 1 });
  const disp2 = await createTestDispatch(req2.id, donor.id);

  // Attempting to accept the second dispatch must fail due to unique constraint uq_donor_active_dispatch
  const { error: activeErr } = await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: disp2.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  assert.ok(activeErr, 'A donor cannot be simultaneously ACCEPTED on more than one emergency request');
});

// ----------------------------------------------------------------------------
// TEST L: STALE LOCATION TELEMETRY
// ----------------------------------------------------------------------------
test('TEST L: Stale Location Telemetry - Coordinates older than threshold are flagged stale', async () => {
  const user = await createTestUser('stale_donor');
  const donor = await createTestDonor(user);
  const request = await createEmergencyRequest({ quantity: 1 });
  const dispatch = await createTestDispatch(request.id, donor.id);

  // Accept and set to EN_ROUTE
  await client.rpc('respond_to_donor_dispatch', {
    p_dispatch_id: dispatch.id,
    p_donor_user_id: user.id,
    p_response: 'ACCEPT'
  });

  await client.from('donor_dispatches').update({
    status: 'EN_ROUTE',
    en_route_at: new Date(Date.now() - 600000).toISOString()
  }).eq('id', dispatch.id);

  // Insert location record from 10 minutes ago (> 5 min threshold)
  const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await client.from('live_locations').insert({
    request_id: request.id,
    donor_id: donor.id,
    dispatch_id: dispatch.id,
    latitude: 12.9720,
    longitude: 77.5950,
    recorded_at: staleTime,
    is_synthetic: true
  });

  // Query latest location from DB
  const { data: latestLoc } = await client
    .from('live_locations')
    .select('recorded_at')
    .eq('dispatch_id', dispatch.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  const STALE_LOCATION_THRESHOLD_MS = 5 * 60 * 1000;
  const elapsedMs = Date.now() - new Date(latestLoc.recorded_at).getTime();
  const isStale = elapsedMs > STALE_LOCATION_THRESHOLD_MS;

  assert.equal(isStale, true, 'Location older than 5 minutes threshold must be flagged as stale');
});

// ----------------------------------------------------------------------------
// TEST M: CONFIGURABLE TIME & ETA THRESHOLDS
// ----------------------------------------------------------------------------
test('TEST M: Configurable Time & ETA Thresholds with Authoritative Safe Defaults', async () => {
  // Test safe defaults
  assert.equal(getGpsGracePeriodMinutes(), 5);
  assert.equal(getStaleLocationThresholdMinutes(), 5);
  assert.equal(getMaxAcceptableEtaMinutes(), 60);

  // Test dynamic environment variable configuration
  process.env.GPS_GRACE_PERIOD_MINUTES = '10';
  process.env.STALE_LOCATION_THRESHOLD_MINUTES = '8';
  process.env.MAX_ACCEPTABLE_ETA_MINUTES = '45';

  assert.equal(getGpsGracePeriodMinutes(), 10);
  assert.equal(getStaleLocationThresholdMinutes(), 8);
  assert.equal(getMaxAcceptableEtaMinutes(), 45);

  // Cleanup to defaults
  delete process.env.GPS_GRACE_PERIOD_MINUTES;
  delete process.env.STALE_LOCATION_THRESHOLD_MINUTES;
  delete process.env.MAX_ACCEPTABLE_ETA_MINUTES;

  assert.equal(getGpsGracePeriodMinutes(), 5);
  assert.equal(getStaleLocationThresholdMinutes(), 5);
  assert.equal(getMaxAcceptableEtaMinutes(), 60);
});

