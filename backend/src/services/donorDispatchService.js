import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { rankEligibleDonors } from './donorRankingService.js';
import { sendDispatchBatchNotifications } from './notificationService.js';

const ACTIVE_DISPATCH_STATUSES = ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'];
const FULFILLED_OR_ACTIVE_STATUSES = ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED'];
const MAX_BATCH_SIZE = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getNextBatchNumber(requestId) {
  const { data, error } = await supabaseAdmin
    .from('donor_dispatches')
    .select('batch_number')
    .eq('request_id', requestId)
    .order('batch_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const err = new Error(error.message || 'Failed to determine donor dispatch batch');
    err.code = error.code;
    throw err;
  }

  return Number(data?.batch_number || 0) + 1;
}

export async function createNextDonorDispatchBatch({ request, actorUserId, batchSize = MAX_BATCH_SIZE }) {
  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0
    ? Math.min(batchSize, MAX_BATCH_SIZE)
    : MAX_BATCH_SIZE;

  // 1. Revalidate Request State: prevent stale state dispatch if request became fulfilled/cancelled
  const { data: currentRequest, error: reqError } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, status, quantity')
    .eq('id', request.id)
    .maybeSingle();

  if (reqError) {
    const err = new Error(reqError.message || 'Failed to revalidate emergency request');
    err.code = reqError.code;
    throw err;
  }

  if (!currentRequest || !['OPEN', 'PARTIALLY_FULFILLED'].includes(currentRequest.status)) {
    const err = new Error('Emergency request is no longer open for donor dispatch');
    err.code = 'REQUEST_NOT_OPEN';
    throw err;
  }

  // 2. Over-Dispatch Protection: calculate remaining needed units accounting for inventory and existing dispatches
  const { data: allocations, error: allocError } = await supabaseAdmin
    .from('request_inventory_allocations')
    .select('allocated_units')
    .eq('request_id', request.id)
    .eq('status', 'RESERVED');

  if (allocError) {
    const err = new Error(allocError.message || 'Failed to inspect inventory allocations');
    err.code = allocError.code;
    throw err;
  }

  const reservedInventoryUnits = (allocations || []).reduce(
    (sum, row) => sum + Number(row.allocated_units || 0),
    0
  );

  const { data: existingDispatches, error: existingError } = await supabaseAdmin
    .from('donor_dispatches')
    .select('id, donor_id, status')
    .eq('request_id', request.id)
    .in('status', FULFILLED_OR_ACTIVE_STATUSES);

  if (existingError) {
    const err = new Error(existingError.message || 'Failed to inspect existing donor dispatches');
    err.code = existingError.code;
    throw err;
  }

  const activeOrFulfilledDispatchUnits = (existingDispatches || []).length;
  const totalCoveredUnits = reservedInventoryUnits + activeOrFulfilledDispatchUnits;
  const remainingUnitsNeeded = Math.max(0, Number(currentRequest.quantity) - totalCoveredUnits);

  if (remainingUnitsNeeded === 0) {
    return {
      modelVersion: null,
      candidateCount: 0,
      batchNumber: null,
      dispatches: [],
      notified: false,
      reason: 'REQUEST_ALREADY_FULFILLED'
    };
  }

  const targetBatchSize = Math.min(safeBatchSize, remainingUnitsNeeded);

  // 3. Rank Eligible Donors
  const ranking = await rankEligibleDonors({
    request: { ...request, quantity: remainingUnitsNeeded },
    limit: 500,
    batchSize: targetBatchSize
  });

  if (!ranking.rankedDonors?.length) {
    return {
      modelVersion: ranking.modelVersion,
      rankingSource: ranking.rankingSource,
      candidateCount: ranking.candidateCount,
      batchNumber: null,
      dispatches: [],
      notified: false,
      reason: ranking.candidateCount === 0 ? 'NO_ELIGIBLE_DONORS' : 'NO_AVAILABLE_NEXT_BATCH'
    };
  }

  // 4. Candidate Backfill: filter out active donors from rankedDonors and backfill up to targetBatchSize
  const activeDonorIds = new Set(
    (existingDispatches || [])
      .filter((d) => ACTIVE_DISPATCH_STATUSES.includes(d.status))
      .map((row) => row.donor_id)
  );

  const availableCandidates = ranking.rankedDonors.filter(
    (donor) => !activeDonorIds.has(donor.donorId)
  );

  if (!availableCandidates.length) {
    return {
      modelVersion: ranking.modelVersion,
      rankingSource: ranking.rankingSource,
      candidateCount: ranking.candidateCount,
      batchNumber: null,
      dispatches: [],
      notified: false,
      reason: 'NO_AVAILABLE_NEXT_BATCH'
    };
  }

  const candidates = availableCandidates.slice(0, targetBatchSize);

  // 5. Try Atomic PostgreSQL RPC if available
  if (typeof supabaseAdmin.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('create_donor_dispatch_batch', {
        p_request_id: request.id,
        p_actor_user_id: actorUserId,
        p_donor_ids: candidates.map((d) => d.donorId),
        p_priority_scores: candidates.map((d) => Number(d.responseProbability)),
        p_model_version: ranking.modelVersion
      });

      if (!rpcError && rpcData?.length) {
        let notificationOutcome = { notified: false, results: [] };
        try {
          notificationOutcome = await sendDispatchBatchNotifications({
            request,
            dispatches: rpcData,
            actorUserId
          });
        } catch (notifyErr) {
          console.error('Non-blocking notification delivery failure (RPC):', notifyErr.message || notifyErr);
        }

        return {
          modelVersion: ranking.modelVersion,
          rankingSource: ranking.rankingSource,
          candidateCount: ranking.candidateCount,
          batchNumber: rpcData[0]?.batch_number,
          dispatches: rpcData,
          notified: Boolean(notificationOutcome?.notified),
          auditLogged: true,
          auditError: null,
          notifications: notificationOutcome?.results || []
        };
      } else if (rpcError) {
        if (rpcError.code === '55000') {
          const err = new Error('Emergency request is no longer open for donor dispatch');
          err.code = 'REQUEST_NOT_OPEN';
          throw err;
        }
        if (rpcError.code === '23505') {
          throw rpcError;
        }
        // If function doesn't exist (e.g. in environments before migration), fall back to direct operations
      }
    } catch (err) {
      if (err.code === '23505' || err.code === 'REQUEST_NOT_OPEN') throw err;
    }
  }

  // 6. Direct Table Operations (Fallback)
  const batchNumber = await getNextBatchNumber(request.id);
  const rows = candidates.map((donor) => ({
    request_id: request.id,
    donor_id: donor.donorId,
    batch_number: batchNumber,
    priority_score: Number(donor.responseProbability),
    status: 'PENDING',
    is_synthetic: false
  }));

  const { data: insertedDispatches, error: insertError } = await supabaseAdmin
    .from('donor_dispatches')
    .insert(rows)
    .select('id, request_id, donor_id, batch_number, priority_score, eta, status, notified_at, responded_at, accepted_at, created_at');

  if (insertError) {
    const err = new Error(insertError.message || 'Failed to create donor dispatch batch');
    err.code = insertError.code;
    throw err;
  }

  const dispatches = insertedDispatches;

  // 7. Audit Logging with Fail-Closed / Compensating Transaction
  const { error: auditError } = await supabaseAdmin
    .from('audit_logs')
    .insert({
      actor_user_id: actorUserId,
      action: 'DONOR_DISPATCH_BATCH_CREATED',
      entity_type: 'emergency_request',
      entity_id: request.id,
      metadata: {
        batch_number: batchNumber,
        dispatch_count: dispatches.length,
        donor_ids: dispatches.map((dispatch) => dispatch.donor_id),
        model_version: ranking.modelVersion
      },
      is_synthetic: false
    });

  if (auditError) {
    // Compensating delete to prevent unaudited medical action
    const dispatchIds = (dispatches || []).map((d) => d.id).filter(Boolean);
    if (dispatchIds.length) {
      await supabaseAdmin.from('donor_dispatches').delete().in('id', dispatchIds);
    }
    const err = new Error('Failed to record dispatch audit event');
    err.code = 'AUDIT_LOG_FAILED';
    throw err;
  }

  let notificationOutcome = { notified: false, results: [] };
  try {
    notificationOutcome = await sendDispatchBatchNotifications({
      request,
      dispatches,
      actorUserId
    });
  } catch (notifyErr) {
    console.error('Non-blocking notification delivery failure (fallback):', notifyErr.message || notifyErr);
  }

  return {
    modelVersion: ranking.modelVersion,
    rankingSource: ranking.rankingSource,
    candidateCount: ranking.candidateCount,
    batchNumber,
    dispatches,
    notified: Boolean(notificationOutcome?.notified),
    auditLogged: true,
    auditError: null,
    notifications: notificationOutcome?.results || []
  };
}

/**
 * Send in-app notification to active staff members of the requesting hospital upon donor acceptance.
 * Sanitized: omits patient PII/PHI.
 * Idempotent: avoids duplicate notifications for the same dispatch.
 */
async function notifyHospitalOnDonorAccept({ requestId, dispatchId, donorId, remainingUnits, actorUserId }) {
  const { data: request, error: reqErr } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, hospital_id, blood_group, resource_type, urgency')
    .eq('id', requestId)
    .maybeSingle();

  if (reqErr || !request?.hospital_id) return;

  const { data: members, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('hospital_id', request.hospital_id)
    .eq('organization_type', 'HOSPITAL')
    .eq('is_active', true);

  if (memErr || !members?.length) return;

  const title = `Donor Accepted: ${request.blood_group} (${request.resource_type})`;
  const body = `A verified donor has accepted the emergency dispatch for ${request.blood_group} (${request.resource_type}, urgency: ${request.urgency}). Remaining units needed: ${remainingUnits}.`;

  for (const member of members) {
    if (!member.user_id) continue;
    try {
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('user_id', member.user_id)
        .eq('request_id', requestId)
        .contains('metadata', { dispatch_id: dispatchId })
        .maybeSingle();

      if (existing) continue;

      await supabaseAdmin.from('notifications').insert({
        user_id: member.user_id,
        donor_dispatch_id: null, // set null to avoid conflicting with donor dispatch unique partial index
        request_id: requestId,
        channel: 'IN_APP',
        status: 'DELIVERED',
        title,
        body,
        metadata: {
          dispatch_id: dispatchId,
          donor_id: donorId,
          blood_group: request.blood_group,
          resource_type: request.resource_type,
          urgency: request.urgency,
          remaining_units: remainingUnits
        },
        sent_at: new Date().toISOString()
      });
    } catch (insertErr) {
      console.error(`Failed to notify hospital user ${member.user_id}:`, insertErr.message || insertErr);
    }
  }
}

/**
 * Direct table operations fallback for donor response if RPC is unavailable.
 */
async function executeDirectDonorResponse({ dispatchId, donorUserId, response }) {
  // 1. Resolve donor profile
  const { data: donor, error: donorErr } = await supabaseAdmin
    .from('donors')
    .select('id, user_id')
    .eq('user_id', donorUserId)
    .maybeSingle();

  if (donorErr || !donor) {
    const err = new Error('Donor profile not found for authenticated user');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 2. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Verify ownership
  if (dispatch.donor_id !== donor.id) {
    const err = new Error('Unauthorized: dispatch does not belong to this donor');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Handle DECLINE
  if (response === 'DECLINE') {
    if (dispatch.status === 'DECLINED') {
      const { data: req } = await supabaseAdmin
        .from('emergency_requests')
        .select('id, quantity, status')
        .eq('id', dispatch.request_id)
        .maybeSingle();

      return {
        dispatch_id: dispatch.id,
        request_id: dispatch.request_id,
        donor_id: dispatch.donor_id,
        dispatch_status: dispatch.status,
        request_status: req?.status || 'OPEN',
        remaining_units: req?.quantity || 0,
        is_already_responded: true,
        responded_at: dispatch.responded_at,
        accepted_at: dispatch.accepted_at
      };
    }

    if (['ACCEPTED', 'COMPLETED'].includes(dispatch.status)) {
      const err = new Error('Cannot decline a dispatch that is already accepted or completed');
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    if (!['PENDING', 'NOTIFIED', 'RESPONDED'].includes(dispatch.status)) {
      const err = new Error(`Cannot decline dispatch in status ${dispatch.status}`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    const nowIso = new Date().toISOString();
    const { data: updatedDispatch, error: updateErr } = await supabaseAdmin
      .from('donor_dispatches')
      .update({
        status: 'DECLINED',
        responded_at: dispatch.responded_at || nowIso
      })
      .eq('id', dispatchId)
      .select('*')
      .single();

    if (updateErr) {
      const err = new Error(updateErr.message || 'Failed to update dispatch status');
      err.code = updateErr.code;
      throw err;
    }

    const { data: req } = await supabaseAdmin
      .from('emergency_requests')
      .select('id, quantity, status')
      .eq('id', dispatch.request_id)
      .maybeSingle();

    return {
      dispatch_id: updatedDispatch.id,
      request_id: updatedDispatch.request_id,
      donor_id: updatedDispatch.donor_id,
      dispatch_status: updatedDispatch.status,
      request_status: req?.status || 'OPEN',
      remaining_units: req?.quantity || 0,
      is_already_responded: false,
      responded_at: updatedDispatch.responded_at,
      accepted_at: updatedDispatch.accepted_at
    };
  }

  // 5. Handle ACCEPT
  if (response === 'ACCEPT') {
    if (dispatch.status === 'ACCEPTED') {
      const { data: req } = await supabaseAdmin
        .from('emergency_requests')
        .select('id, quantity, status')
        .eq('id', dispatch.request_id)
        .maybeSingle();

      return {
        dispatch_id: dispatch.id,
        request_id: dispatch.request_id,
        donor_id: dispatch.donor_id,
        dispatch_status: dispatch.status,
        request_status: req?.status || 'PARTIALLY_FULFILLED',
        remaining_units: 0,
        is_already_responded: true,
        responded_at: dispatch.responded_at,
        accepted_at: dispatch.accepted_at
      };
    }

    if (dispatch.status === 'DECLINED') {
      const err = new Error('Cannot accept a dispatch that has already been declined');
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    if (!['PENDING', 'NOTIFIED', 'RESPONDED'].includes(dispatch.status)) {
      const err = new Error(`Cannot accept dispatch in status ${dispatch.status}`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    const { data: req, error: reqErr } = await supabaseAdmin
      .from('emergency_requests')
      .select('id, quantity, status, completed_at')
      .eq('id', dispatch.request_id)
      .maybeSingle();

    if (reqErr || !req) {
      const err = new Error('Emergency request not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(req.status)) {
      const err = new Error('Emergency request is no longer open for donor acceptance');
      err.code = 'REQUEST_NOT_OPEN';
      throw err;
    }

    // Inspect inventory and accepted dispatches
    const { data: allocations } = await supabaseAdmin
      .from('request_inventory_allocations')
      .select('allocated_units')
      .eq('request_id', req.id)
      .eq('status', 'RESERVED');

    const reservedInv = (allocations || []).reduce((sum, r) => sum + Number(r.allocated_units || 0), 0);

    const { data: acceptedDispatches } = await supabaseAdmin
      .from('donor_dispatches')
      .select('id')
      .eq('request_id', req.id)
      .in('status', ['ACCEPTED', 'COMPLETED']);

    const acceptedCount = (acceptedDispatches || []).length;
    const totalCovered = reservedInv + acceptedCount;
    const remainingUnits = Math.max(0, req.quantity - totalCovered);

    if (remainingUnits <= 0) {
      const err = new Error('Emergency request is already fully fulfilled');
      err.code = 'REQUEST_ALREADY_FULFILLED';
      throw err;
    }

    const nowIso = new Date().toISOString();
    const { data: updatedDispatch, error: updateErr } = await supabaseAdmin
      .from('donor_dispatches')
      .update({
        status: 'ACCEPTED',
        responded_at: dispatch.responded_at || nowIso,
        accepted_at: nowIso
      })
      .eq('id', dispatchId)
      .select('*')
      .single();

    if (updateErr) {
      const err = new Error(updateErr.message || 'Failed to accept donor dispatch');
      err.code = updateErr.code;
      throw err;
    }

    const newRemaining = Math.max(0, remainingUnits - 1);
    const newRequestStatus = newRemaining === 0 ? 'FULFILLED' : 'PARTIALLY_FULFILLED';

    await supabaseAdmin
      .from('emergency_requests')
      .update({
        status: newRequestStatus,
        completed_at: newRemaining === 0 ? nowIso : null
      })
      .eq('id', req.id);

    return {
      dispatch_id: updatedDispatch.id,
      request_id: updatedDispatch.request_id,
      donor_id: updatedDispatch.donor_id,
      dispatch_status: updatedDispatch.status,
      request_status: newRequestStatus,
      remaining_units: newRemaining,
      is_already_responded: false,
      responded_at: updatedDispatch.responded_at,
      accepted_at: updatedDispatch.accepted_at
    };
  }

  const err = new Error('Invalid response');
  err.code = 'INVALID_RESPONSE';
  throw err;
}

/**
 * Respond to an active donor dispatch (ACCEPT or DECLINE).
 * Strictly authenticates that the dispatch belongs to the donor mapped to donorUserId.
 * Atomically updates dispatch and emergency request fulfillment state.
 * Emits audit log and notifies hospital on ACCEPT without sensitive details.
 */
export async function respondToDonorDispatch({ dispatchId, donorUserId, response }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('Invalid dispatchId UUID');
    err.code = 'INVALID_ID';
    throw err;
  }

  const normResponse = String(response || '').trim().toUpperCase();
  if (!['ACCEPT', 'DECLINE'].includes(normResponse)) {
    const err = new Error('Response must be either ACCEPT or DECLINE');
    err.code = 'INVALID_RESPONSE';
    throw err;
  }

  if (!donorUserId) {
    const err = new Error('donorUserId is required');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  // 1. Try atomic PostgreSQL RPC first
  let rpcSucceeded = false;
  let resultRecord = null;

  try {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('respond_to_donor_dispatch', {
      p_dispatch_id: dispatchId,
      p_donor_user_id: donorUserId,
      p_response: normResponse
    });

    if (!rpcError && rpcData?.length) {
      rpcSucceeded = true;
      resultRecord = rpcData[0];
    } else if (rpcError) {
      if (rpcError.code === '42501') {
        const err = new Error(rpcError.message || 'Unauthorized access to donor dispatch');
        err.code = 'FORBIDDEN';
        throw err;
      }
      if (rpcError.code === 'P0002') {
        const err = new Error(rpcError.message || 'Dispatch or request not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (rpcError.code === '55000') {
        const err = new Error(rpcError.message || 'Invalid state transition or request not open');
        if (rpcError.message?.includes('already fully fulfilled')) {
          err.code = 'REQUEST_ALREADY_FULFILLED';
        } else if (rpcError.message?.includes('no longer open')) {
          err.code = 'REQUEST_NOT_OPEN';
        } else {
          err.code = 'INVALID_STATE_TRANSITION';
        }
        throw err;
      }
      if (rpcError.code === '22023') {
        const err = new Error(rpcError.message || 'Invalid response value');
        err.code = 'INVALID_RESPONSE';
        throw err;
      }
    }
  } catch (err) {
    if (['FORBIDDEN', 'NOT_FOUND', 'INVALID_STATE_TRANSITION', 'REQUEST_ALREADY_FULFILLED', 'REQUEST_NOT_OPEN', 'INVALID_RESPONSE'].includes(err.code)) {
      throw err;
    }
  }

  // 2. Direct operations fallback (if RPC unavailable)
  if (!rpcSucceeded) {
    resultRecord = await executeDirectDonorResponse({ dispatchId, donorUserId, response: normResponse });
  }

  // 3. Audit logging (DONOR_DISPATCH_ACCEPTED or DONOR_DISPATCH_DECLINED)
  const auditAction = normResponse === 'ACCEPT' ? 'DONOR_DISPATCH_ACCEPTED' : 'DONOR_DISPATCH_DECLINED';
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: donorUserId,
      action: auditAction,
      entity_type: 'donor_dispatch',
      entity_id: dispatchId,
      metadata: {
        request_id: resultRecord.request_id,
        donor_id: resultRecord.donor_id,
        dispatch_status: resultRecord.dispatch_status,
        request_status: resultRecord.request_status,
        remaining_units: resultRecord.remaining_units,
        is_already_responded: Boolean(resultRecord.is_already_responded)
      },
      is_synthetic: false
    });
  } catch (auditErr) {
    console.error(`Audit logging failed for ${auditAction}:`, auditErr.message || auditErr);
  }

  // 4. Hospital Notification on ACCEPT (only if newly accepted, not if duplicate/already accepted)
  if (normResponse === 'ACCEPT' && !resultRecord.is_already_responded) {
    try {
      await notifyHospitalOnDonorAccept({
        requestId: resultRecord.request_id,
        dispatchId: resultRecord.dispatch_id,
        donorId: resultRecord.donor_id,
        remainingUnits: resultRecord.remaining_units,
        actorUserId: donorUserId
      });
    } catch (notifyErr) {
      console.error('Hospital notification failed on donor acceptance:', notifyErr.message || notifyErr);
    }
  }

  return {
    dispatchId: resultRecord.dispatch_id,
    requestId: resultRecord.request_id,
    donorId: resultRecord.donor_id,
    dispatchStatus: resultRecord.dispatch_status,
    requestStatus: resultRecord.request_status,
    remainingUnits: resultRecord.remaining_units,
    isAlreadyResponded: Boolean(resultRecord.is_already_responded),
    respondedAt: resultRecord.responded_at,
    acceptedAt: resultRecord.accepted_at
  };
}

/**
 * Send in-app notification to active hospital staff on tracking lifecycle milestones.
 * Strictly sanitized: omits patient PII/PHI.
 * Idempotent: verifies against existing notifications matching dispatch_id and event.
 */
async function notifyHospitalOnTrackingEvent({ requestId, dispatchId, donorId, event, title, body, metadata = {} }) {
  const { data: request, error: reqErr } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, hospital_id, blood_group, resource_type, urgency')
    .eq('id', requestId)
    .maybeSingle();

  if (reqErr || !request?.hospital_id) return;

  const { data: members, error: memErr } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('hospital_id', request.hospital_id)
    .eq('organization_type', 'HOSPITAL')
    .eq('is_active', true);

  if (memErr || !members?.length) return;

  for (const member of members) {
    if (!member.user_id) continue;
    try {
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('id')
        .eq('user_id', member.user_id)
        .eq('request_id', requestId)
        .contains('metadata', { dispatch_id: dispatchId, event })
        .maybeSingle();

      if (existing) continue;

      await supabaseAdmin.from('notifications').insert({
        user_id: member.user_id,
        donor_dispatch_id: null, // Avoid colliding with donor dispatch unique partial index
        request_id: requestId,
        channel: 'IN_APP',
        status: 'DELIVERED',
        title,
        body,
        metadata: {
          dispatch_id: dispatchId,
          donor_id: donorId,
          event,
          ...metadata
        },
        sent_at: new Date().toISOString()
      });
    } catch (insertErr) {
      console.error(`Failed to notify hospital user ${member.user_id}:`, insertErr.message || insertErr);
    }
  }
}

/**
 * Start donor tracking: transitions ACCEPTED -> EN_ROUTE.
 * Strictly authenticated to the donor owning the dispatch.
 */
export async function startDonorTracking({ dispatchId, donorUserId }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('dispatchId must be a valid UUID');
    err.code = 'INVALID_DISPATCH_ID';
    throw err;
  }

  // 1. Resolve donor profile
  const { data: donor, error: donorErr } = await supabaseAdmin
    .from('donors')
    .select('id, user_id')
    .eq('user_id', donorUserId)
    .maybeSingle();

  if (donorErr || !donor) {
    const err = new Error('Donor profile not found for authenticated user');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 2. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Verify ownership
  if (dispatch.donor_id !== donor.id) {
    const err = new Error('Unauthorized: dispatch does not belong to this donor');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Idempotency: if already EN_ROUTE
  if (dispatch.status === 'EN_ROUTE') {
    return {
      dispatchId: dispatch.id,
      requestId: dispatch.request_id,
      donorId: dispatch.donor_id,
      status: 'EN_ROUTE',
      enRouteAt: dispatch.en_route_at || dispatch.created_at,
      isAlreadyStarted: true
    };
  }

  // 5. State transition validation: must be ACCEPTED
  if (dispatch.status !== 'ACCEPTED') {
    const err = new Error(`Cannot start tracking for dispatch in status ${dispatch.status}`);
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }

  // 6. Transition to EN_ROUTE
  const nowIso = new Date().toISOString();
  const { data: updatedDispatch, error: updateErr } = await supabaseAdmin
    .from('donor_dispatches')
    .update({
      status: 'EN_ROUTE',
      en_route_at: nowIso
    })
    .eq('id', dispatchId)
    .select('*')
    .single();

  if (updateErr) {
    const err = new Error(updateErr.message || 'Failed to update dispatch to EN_ROUTE');
    err.code = updateErr.code || 'UPDATE_FAILED';
    throw err;
  }

  // 7. Audit log: DONOR_DISPATCH_EN_ROUTE
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: donorUserId,
      action: 'DONOR_DISPATCH_EN_ROUTE',
      entity_type: 'donor_dispatch',
      entity_id: dispatchId,
      metadata: {
        request_id: dispatch.request_id,
        donor_id: donor.id
      },
      is_synthetic: false
    });
  } catch (auditErr) {
    console.error('Audit logging failed for DONOR_DISPATCH_EN_ROUTE:', auditErr.message || auditErr);
  }

  // 8. Hospital notification
  try {
    await notifyHospitalOnTrackingEvent({
      requestId: dispatch.request_id,
      dispatchId: dispatch.id,
      donorId: donor.id,
      event: 'DONOR_DISPATCH_EN_ROUTE',
      title: 'Donor En Route',
      body: 'Donor is on the way.'
    });
  } catch (notifErr) {
    console.error('Hospital notification failed for EN_ROUTE:', notifErr.message || notifErr);
  }

  return {
    dispatchId: updatedDispatch.id,
    requestId: updatedDispatch.request_id,
    donorId: updatedDispatch.donor_id,
    status: 'EN_ROUTE',
    enRouteAt: nowIso,
    isAlreadyStarted: false
  };
}

/**
 * Record donor live location update: appends to public.live_locations.
 * Strictly validated: latitude between -90 and 90, longitude between -180 and 180, finite numbers.
 * Dispatch must be in EN_ROUTE status.
 */
export async function recordDonorLocation({ dispatchId, donorUserId, latitude, longitude }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('dispatchId must be a valid UUID');
    err.code = 'INVALID_DISPATCH_ID';
    throw err;
  }

  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    const err = new Error('Latitude must be between -90 and 90, longitude between -180 and 180');
    err.code = 'INVALID_LOCATION';
    throw err;
  }

  // 1. Resolve donor profile
  const { data: donor, error: donorErr } = await supabaseAdmin
    .from('donors')
    .select('id, user_id')
    .eq('user_id', donorUserId)
    .maybeSingle();

  if (donorErr || !donor) {
    const err = new Error('Donor profile not found for authenticated user');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 2. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Verify ownership
  if (dispatch.donor_id !== donor.id) {
    const err = new Error('Unauthorized: dispatch does not belong to this donor');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Must be EN_ROUTE
  if (dispatch.status !== 'EN_ROUTE') {
    const err = new Error(`Location updates are only accepted when dispatch is EN_ROUTE (current status: ${dispatch.status})`);
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }

  const nowIso = new Date().toISOString();

  // 5. Insert into live_locations with server-generated timestamp
  const { data: locationRecord, error: locErr } = await supabaseAdmin
    .from('live_locations')
    .insert({
      dispatch_id: dispatch.id,
      donor_id: donor.id,
      request_id: dispatch.request_id,
      latitude: lat,
      longitude: lon,
      recorded_at: nowIso,
      is_synthetic: false
    })
    .select('*')
    .maybeSingle();

  if (locErr) {
    console.error('Failed to insert live_locations record:', locErr);
  }

  // 6. Update current coordinates in donor_dispatches
  await supabaseAdmin
    .from('donor_dispatches')
    .update({
      current_latitude: lat,
      current_longitude: lon
    })
    .eq('id', dispatchId);

  // 7. Audit log (sanitized: do NOT log raw coordinates in audit metadata)
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: donorUserId,
      action: 'DONOR_DISPATCH_LOCATION_UPDATED',
      entity_type: 'donor_dispatch',
      entity_id: dispatchId,
      metadata: {
        request_id: dispatch.request_id,
        donor_id: donor.id
      },
      is_synthetic: false
    });
  } catch (auditErr) {
    console.error('Audit logging failed for DONOR_DISPATCH_LOCATION_UPDATED:', auditErr.message || auditErr);
  }

  return {
    dispatchId: dispatch.id,
    requestId: dispatch.request_id,
    latitude: lat,
    longitude: lon,
    recordedAt: locationRecord?.recorded_at || nowIso
  };
}

/**
 * Retrieve tracking state for a dispatch.
 * Accessible ONLY by:
 * 1. The donor who owns the dispatch.
 * 2. Active hospital staff belonging to the hospital that owns the emergency request.
 */
export async function getDispatchTracking({ dispatchId, user, organization }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('dispatchId must be a valid UUID');
    err.code = 'INVALID_DISPATCH_ID';
    throw err;
  }

  // 1. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 2. Lookup emergency request
  const { data: request, error: reqErr } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, hospital_id, blood_group, quantity, status')
    .eq('id', dispatch.request_id)
    .maybeSingle();

  if (reqErr || !request) {
    const err = new Error('Emergency request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Authorization check
  const role = user?.role;
  if (role === 'DONOR') {
    const { data: donor } = await supabaseAdmin
      .from('donors')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!donor || dispatch.donor_id !== donor.id) {
      const err = new Error('Unauthorized access to dispatch tracking');
      err.code = 'FORBIDDEN';
      throw err;
    }
  } else if (role === 'HOSPITAL') {
    const hospitalId = organization?.hospitalId;
    if (!hospitalId || request.hospital_id !== hospitalId) {
      const err = new Error('Hospital is not authorized to view tracking for this dispatch');
      err.code = 'FORBIDDEN';
      throw err;
    }
  } else {
    const err = new Error('Unauthorized role for tracking visibility');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Query latest location from live_locations
  let latestLocation = null;
  try {
    const { data: locs } = await supabaseAdmin
      .from('live_locations')
      .select('latitude, longitude, eta, recorded_at')
      .or(`dispatch_id.eq.${dispatch.id},and(donor_id.eq.${dispatch.donor_id},request_id.eq.${dispatch.request_id})`)
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (locs && locs.length > 0) {
      latestLocation = locs[0];
    }
  } catch (locErr) {
    // Fallback if error querying live_locations
  }

  if (!latestLocation && dispatch.current_latitude != null && dispatch.current_longitude != null) {
    latestLocation = {
      latitude: dispatch.current_latitude,
      longitude: dispatch.current_longitude,
      recorded_at: dispatch.en_route_at || dispatch.accepted_at || dispatch.created_at
    };
  }

  return {
    dispatchId: dispatch.id,
    requestId: dispatch.request_id,
    donorId: dispatch.donor_id,
    status: dispatch.status,
    currentLocation: latestLocation ? {
      latitude: latestLocation.latitude,
      longitude: latestLocation.longitude,
      eta: latestLocation.eta ?? null,
      recordedAt: latestLocation.recorded_at
    } : null,
    timestamps: {
      notifiedAt: dispatch.notified_at ?? null,
      acceptedAt: dispatch.accepted_at ?? null,
      enRouteAt: dispatch.en_route_at ?? null,
      arrivedAt: dispatch.arrived_at ?? null,
      completedAt: dispatch.completed_at ?? null
    }
  };
}

/**
 * Mark donor arrival: transitions EN_ROUTE -> ARRIVED.
 * Authorized for:
 * - Active staff of the requesting hospital.
 * - The donor assigned to the dispatch.
 */
export async function markDonorArrived({ dispatchId, user, organization }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('dispatchId must be a valid UUID');
    err.code = 'INVALID_DISPATCH_ID';
    throw err;
  }

  // 1. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 2. Lookup emergency request
  const { data: request, error: reqErr } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, hospital_id')
    .eq('id', dispatch.request_id)
    .maybeSingle();

  if (reqErr || !request) {
    const err = new Error('Emergency request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Authorization check
  const role = user?.role;
  if (role === 'HOSPITAL') {
    const hospitalId = organization?.hospitalId;
    if (!hospitalId || request.hospital_id !== hospitalId) {
      const err = new Error('Hospital is not authorized to mark arrival for this dispatch');
      err.code = 'FORBIDDEN';
      throw err;
    }
  } else if (role === 'DONOR') {
    const { data: donor } = await supabaseAdmin
      .from('donors')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!donor || dispatch.donor_id !== donor.id) {
      const err = new Error('Donor is not authorized to mark arrival for this dispatch');
      err.code = 'FORBIDDEN';
      throw err;
    }
  } else {
    const err = new Error('Unauthorized role for marking arrival');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Idempotency: if already ARRIVED
  if (dispatch.status === 'ARRIVED') {
    return {
      dispatchId: dispatch.id,
      requestId: dispatch.request_id,
      donorId: dispatch.donor_id,
      status: 'ARRIVED',
      arrivedAt: dispatch.arrived_at || dispatch.created_at,
      isAlreadyArrived: true
    };
  }

  // 5. State transition check: must be EN_ROUTE
  if (dispatch.status !== 'EN_ROUTE') {
    const err = new Error(`Cannot mark dispatch as arrived from status ${dispatch.status}`);
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }

  // 6. Transition to ARRIVED
  const nowIso = new Date().toISOString();
  const { data: updatedDispatch, error: updateErr } = await supabaseAdmin
    .from('donor_dispatches')
    .update({
      status: 'ARRIVED',
      arrived_at: nowIso
    })
    .eq('id', dispatchId)
    .select('*')
    .single();

  if (updateErr) {
    const err = new Error(updateErr.message || 'Failed to update dispatch to ARRIVED');
    err.code = updateErr.code || 'UPDATE_FAILED';
    throw err;
  }

  // 7. Audit log: DONOR_DISPATCH_ARRIVED
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'DONOR_DISPATCH_ARRIVED',
      entity_type: 'donor_dispatch',
      entity_id: dispatchId,
      metadata: {
        request_id: dispatch.request_id,
        donor_id: dispatch.donor_id
      },
      is_synthetic: false
    });
  } catch (auditErr) {
    console.error('Audit logging failed for DONOR_DISPATCH_ARRIVED:', auditErr.message || auditErr);
  }

  // 8. Hospital notification
  try {
    await notifyHospitalOnTrackingEvent({
      requestId: dispatch.request_id,
      dispatchId: dispatch.id,
      donorId: dispatch.donor_id,
      event: 'DONOR_DISPATCH_ARRIVED',
      title: 'Donor Arrived',
      body: 'Donor has arrived.'
    });
  } catch (notifErr) {
    console.error('Hospital notification failed for ARRIVED:', notifErr.message || notifErr);
  }

  return {
    dispatchId: updatedDispatch.id,
    requestId: updatedDispatch.request_id,
    donorId: updatedDispatch.donor_id,
    status: 'ARRIVED',
    arrivedAt: nowIso,
    isAlreadyArrived: false
  };
}

/**
 * Complete donor dispatch: transitions ARRIVED -> COMPLETED.
 * Strictly authorized to active staff of the requesting hospital.
 * Preserves fulfillment accounting idempotently without double-counting units.
 */
export async function completeDonorDispatch({ dispatchId, user, organization }) {
  if (!dispatchId || !UUID_RE.test(dispatchId)) {
    const err = new Error('dispatchId must be a valid UUID');
    err.code = 'INVALID_DISPATCH_ID';
    throw err;
  }

  // 1. Lookup dispatch
  const { data: dispatch, error: dispatchErr } = await supabaseAdmin
    .from('donor_dispatches')
    .select('*')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchErr || !dispatch) {
    const err = new Error('Donor dispatch not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 2. Lookup emergency request
  const { data: request, error: reqErr } = await supabaseAdmin
    .from('emergency_requests')
    .select('id, hospital_id, status, quantity, completed_at')
    .eq('id', dispatch.request_id)
    .maybeSingle();

  if (reqErr || !request) {
    const err = new Error('Emergency request not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Authorization: requesting hospital staff only
  const hospitalId = organization?.hospitalId;
  if (!hospitalId || request.hospital_id !== hospitalId) {
    const err = new Error('Only staff of the requesting hospital can complete donor dispatches');
    err.code = 'FORBIDDEN';
    throw err;
  }

  // 4. Idempotency: if already COMPLETED
  if (dispatch.status === 'COMPLETED') {
    return {
      dispatchId: dispatch.id,
      requestId: dispatch.request_id,
      donorId: dispatch.donor_id,
      status: 'COMPLETED',
      requestStatus: request.status,
      completedAt: dispatch.completed_at || dispatch.created_at,
      isAlreadyCompleted: true
    };
  }

  // 5. State transition check: must be ARRIVED
  if (dispatch.status !== 'ARRIVED') {
    const err = new Error(`Cannot complete dispatch in status ${dispatch.status}`);
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }

  // 6. Transition to COMPLETED
  const nowIso = new Date().toISOString();
  const { data: updatedDispatch, error: updateErr } = await supabaseAdmin
    .from('donor_dispatches')
    .update({
      status: 'COMPLETED',
      completed_at: nowIso
    })
    .eq('id', dispatchId)
    .select('*')
    .single();

  if (updateErr) {
    const err = new Error(updateErr.message || 'Failed to update dispatch to COMPLETED');
    err.code = updateErr.code || 'UPDATE_FAILED';
    throw err;
  }

  // 7. Request Fulfillment Integrity: unit was already accounted on ACCEPTED.
  // Verify request status: if not already FULFILLED, check total allocations.
  let requestStatus = request.status;
  if (requestStatus !== 'FULFILLED') {
    const { data: allocations } = await supabaseAdmin
      .from('request_inventory_allocations')
      .select('allocated_units')
      .eq('request_id', request.id)
      .eq('status', 'RESERVED');

    const reservedInv = (allocations || []).reduce((sum, r) => sum + Number(r.allocated_units || 0), 0);

    const { data: activeDispatches } = await supabaseAdmin
      .from('donor_dispatches')
      .select('id')
      .eq('request_id', request.id)
      .in('status', ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED']);

    const totalCovered = reservedInv + (activeDispatches || []).length;
    if (totalCovered >= request.quantity) {
      requestStatus = 'FULFILLED';
      await supabaseAdmin
        .from('emergency_requests')
        .update({
          status: 'FULFILLED',
          completed_at: request.completed_at || nowIso
        })
        .eq('id', request.id);
    }
  }

  // 8. Audit log: DONOR_DISPATCH_COMPLETED
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_user_id: user.id,
      action: 'DONOR_DISPATCH_COMPLETED',
      entity_type: 'donor_dispatch',
      entity_id: dispatchId,
      metadata: {
        request_id: dispatch.request_id,
        donor_id: dispatch.donor_id
      },
      is_synthetic: false
    });
  } catch (auditErr) {
    console.error('Audit logging failed for DONOR_DISPATCH_COMPLETED:', auditErr.message || auditErr);
  }

  // 9. Hospital notification
  try {
    await notifyHospitalOnTrackingEvent({
      requestId: dispatch.request_id,
      dispatchId: dispatch.id,
      donorId: dispatch.donor_id,
      event: 'DONOR_DISPATCH_COMPLETED',
      title: 'Donor Dispatch Completed',
      body: 'Donor dispatch completed.'
    });
  } catch (notifErr) {
    console.error('Hospital notification failed for COMPLETED:', notifErr.message || notifErr);
  }

  return {
    dispatchId: updatedDispatch.id,
    requestId: updatedDispatch.request_id,
    donorId: updatedDispatch.donor_id,
    status: 'COMPLETED',
    requestStatus,
    completedAt: nowIso,
    isAlreadyCompleted: false
  };
}
