import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createNextDonorDispatchBatch } from '../services/donorDispatchService.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/requests/:requestId/donor-dispatches/next-batch', requireAuth, requireRole('HOSPITAL'), async (req, res) => {
  try {
    const hospitalId = req.organization?.hospitalId;
    if (!hospitalId) {
      return res.status(403).json({
        error: 'HOSPITAL_NOT_PROVISIONED',
        message: 'No active hospital organization is associated with this account'
      });
    }

    const { requestId } = req.params;
    if (!UUID_RE.test(requestId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST_ID', message: 'requestId must be a valid UUID' });
    }

    const { data: request, error: requestError } = await supabaseAdmin
      .from('emergency_requests')
      .select('id, hospital_id, blood_group, quantity, resource_type, urgency, status')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      console.error('Emergency request lookup failed:', requestError);
      return res.status(500).json({ error: 'DATABASE_ERROR', message: 'Failed to load emergency request' });
    }

    if (!request) return res.status(404).json({ error: 'REQUEST_NOT_FOUND', message: 'Emergency request not found' });
    if (request.hospital_id !== hospitalId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Emergency request does not belong to this hospital' });
    }
    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(request.status)) {
      return res.status(409).json({
        error: 'REQUEST_NOT_OPEN',
        message: 'Donor dispatch is only available for open or partially fulfilled requests'
      });
    }

    const requestedBatchSize = Number(req.body?.batchSize ?? 5);
    const batchSize = Number.isInteger(requestedBatchSize) && requestedBatchSize > 0
      ? Math.min(requestedBatchSize, 5)
      : 5;

    const result = await createNextDonorDispatchBatch({
      request,
      actorUserId: req.user.id,
      batchSize
    });

    return res.status(result.dispatches.length ? 201 : 200).json({
      requestId: request.id,
      requestedUnits: request.quantity,
      urgency: request.urgency,
      modelVersion: result.modelVersion,
      rankingSource: result.rankingSource ?? (result.modelVersion ? 'ML' : 'DETERMINISTIC_FALLBACK'),
      candidateCount: result.candidateCount,
      batchNumber: result.batchNumber,
      batchSize: result.dispatches.length,
      dispatches: result.dispatches,
      notified: result.notified,
      auditLogged: result.auditLogged ?? null,
      reason: result.reason ?? null
    });
  } catch (error) {
    console.error('Donor dispatch batch creation failed:', error);
    if (error.code === 'REQUEST_NOT_OPEN') {
      return res.status(409).json({
        error: 'REQUEST_NOT_OPEN',
        message: 'Donor dispatch is only available for open or partially fulfilled requests'
      });
    }
    if (error.code === 'AUDIT_LOG_FAILED') {
      return res.status(500).json({
        error: 'AUDIT_LOG_FAILED',
        message: 'Donor dispatch failed because the audit log could not be recorded'
      });
    }
    if (['ML_NOT_CONFIGURED', 'ML_TIMEOUT', 'ML_INFERENCE_FAILED'].includes(error.code)) {
      return res.status(503).json({
        error: 'ML_SERVICE_UNAVAILABLE',
        message: 'Donor ranking service is temporarily unavailable'
      });
    }
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'DISPATCH_BATCH_CONFLICT',
        message: 'A donor dispatch changed concurrently; retry the batch request'
      });
    }
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create donor dispatch batch'
    });
  }
});

export default router;
