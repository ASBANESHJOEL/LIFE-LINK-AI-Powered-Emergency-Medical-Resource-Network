import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { rankEligibleDonors } from './donorRankingService.js';

const ACTIVE_DISPATCH_STATUSES = ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED'];
const FULFILLED_OR_ACTIVE_STATUSES = ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'COMPLETED'];
const MAX_BATCH_SIZE = 5;

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
        return {
          modelVersion: ranking.modelVersion,
          candidateCount: ranking.candidateCount,
          batchNumber: rpcData[0]?.batch_number,
          dispatches: rpcData,
          notified: false,
          auditLogged: true,
          auditError: null
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

  return {
    modelVersion: ranking.modelVersion,
    candidateCount: ranking.candidateCount,
    batchNumber,
    dispatches,
    notified: false,
    auditLogged: true,
    auditError: null
  };
}
