import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { rankEligibleDonors } from './donorRankingService.js';

const ACTIVE_DISPATCH_STATUSES = ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED'];
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

  const ranking = await rankEligibleDonors({
    request,
    limit: 500,
    batchSize: safeBatchSize
  });

  if (!ranking.nextBatch.length) {
    return {
      modelVersion: ranking.modelVersion,
      candidateCount: ranking.candidateCount,
      batchNumber: null,
      dispatches: [],
      notified: false,
      reason: ranking.candidateCount === 0 ? 'NO_ELIGIBLE_DONORS' : 'NO_AVAILABLE_NEXT_BATCH'
    };
  }

  const batchNumber = await getNextBatchNumber(request.id);
  const donorIds = ranking.nextBatch.map((donor) => donor.donorId);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('donor_dispatches')
    .select('donor_id')
    .eq('request_id', request.id)
    .in('donor_id', donorIds)
    .in('status', ACTIVE_DISPATCH_STATUSES);

  if (existingError) {
    const err = new Error(existingError.message || 'Failed to check existing donor dispatches');
    err.code = existingError.code;
    throw err;
  }

  const activeDonorIds = new Set((existing || []).map((row) => row.donor_id));
  const candidates = ranking.nextBatch.filter((donor) => !activeDonorIds.has(donor.donorId));

  if (!candidates.length) {
    return {
      modelVersion: ranking.modelVersion,
      candidateCount: ranking.candidateCount,
      batchNumber: null,
      dispatches: [],
      notified: false,
      reason: 'NO_AVAILABLE_NEXT_BATCH'
    };
  }

  const rows = candidates.map((donor) => ({
    request_id: request.id,
    donor_id: donor.donorId,
    batch_number: batchNumber,
    priority_score: Number(donor.responseProbability),
    status: 'PENDING',
    is_synthetic: false
  }));

  const { data: dispatches, error: insertError } = await supabaseAdmin
    .from('donor_dispatches')
    .insert(rows)
    .select('id, request_id, donor_id, batch_number, priority_score, eta, status, notified_at, responded_at, accepted_at, created_at');

  if (insertError) {
    const err = new Error(insertError.message || 'Failed to create donor dispatch batch');
    err.code = insertError.code;
    throw err;
  }

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

  return {
    modelVersion: ranking.modelVersion,
    candidateCount: ranking.candidateCount,
    batchNumber,
    dispatches,
    notified: false,
    auditLogged: !auditError,
    auditError: auditError ? 'Failed to record dispatch audit event' : null
  };
}
