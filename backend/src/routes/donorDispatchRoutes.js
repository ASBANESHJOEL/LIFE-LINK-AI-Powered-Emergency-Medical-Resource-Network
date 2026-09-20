import { Router } from 'express';
import { getDonorDispatchRoute } from '../services/osrmService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import {
  createNextDonorDispatchBatch,
  respondToDonorDispatch,
  startDonorTracking,
  recordDonorLocation,
  getDispatchTracking,
  markDonorArrived,
  completeDonorDispatch,
  withdrawDonorDispatch,
  handleGpsTimeout,
  handleEtaExceeded,
  updateDonorAvailability
} from '../services/donorDispatchService.js';

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

router.post('/donor-dispatches/:dispatchId/respond', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const rawResponse = req.body?.response;
    if (!rawResponse || typeof rawResponse !== 'string') {
      return res.status(400).json({ error: 'INVALID_RESPONSE', message: 'response field is required and must be a string' });
    }

    const response = rawResponse.trim().toUpperCase();
    if (!['ACCEPT', 'DECLINE'].includes(response)) {
      return res.status(400).json({ error: 'INVALID_RESPONSE', message: 'response must be either ACCEPT or DECLINE' });
    }

    const result = await respondToDonorDispatch({
      dispatchId,
      donorUserId: req.user.id,
      response
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Donor dispatch response failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message || 'Unauthorized access to donor dispatch' });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message || 'Dispatch or request not found' });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message || 'Invalid state transition' });
    }
    if (error.code === 'REQUEST_ALREADY_FULFILLED') {
      return res.status(409).json({ error: 'REQUEST_ALREADY_FULFILLED', message: 'Emergency request is already fully fulfilled' });
    }
    if (error.code === 'REQUEST_NOT_OPEN') {
      return res.status(409).json({ error: 'REQUEST_NOT_OPEN', message: 'Emergency request is no longer open for donor acceptance' });
    }
    if (error.code === 'INVALID_RESPONSE' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: error.code, message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to process donor dispatch response' });
  }
});

router.post('/donor-dispatches/:dispatchId/tracking/start', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await startDonorTracking({
      dispatchId,
      donorUserId: req.user.id
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Start tracking failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to start tracking' });
  }
});

router.post('/donor-dispatches/:dispatchId/location', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const { latitude, longitude } = req.body || {};
    if (latitude === undefined || longitude === undefined || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'INVALID_LOCATION', message: 'latitude and longitude are required numbers' });
    }

    const result = await recordDonorLocation({
      dispatchId,
      donorUserId: req.user.id,
      latitude,
      longitude
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Location update failed:', error);
    if (error.code === 'INVALID_LOCATION') {
      return res.status(400).json({ error: 'INVALID_LOCATION', message: error.message });
    }
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to record location update' });
  }
});

router.get('/donor-dispatches/:dispatchId/route', requireAuth, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await getDonorDispatchRoute({
      dispatchId,
      user: req.user,
      organization: req.organization
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('OSRM route lookup failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'LOCATION_UNAVAILABLE' || error.code === 'DESTINATION_UNAVAILABLE') {
      return res.status(422).json({ error: error.code, message: error.message });
    }
    if (error.code === 'NO_ROUTE') {
      return res.status(422).json({ error: 'NO_ROUTE', message: 'No drivable route was found for the current coordinates' });
    }
    if (error.code === 'OSRM_TIMEOUT' || error.code === 'OSRM_UNAVAILABLE') {
      return res.status(503).json({ error: 'ROUTING_SERVICE_UNAVAILABLE', message: 'Routing service is temporarily unavailable' });
    }
    if (error.code === 'OSRM_CONFIG_ERROR') {
      return res.status(500).json({ error: 'ROUTING_CONFIGURATION_ERROR', message: 'Routing service is not configured correctly' });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to calculate donor route' });
  }
});

router.get('/donor-dispatches/:dispatchId/tracking', requireAuth, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await getDispatchTracking({
      dispatchId,
      user: req.user,
      organization: req.organization
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Get tracking failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve dispatch tracking' });
  }
});

router.post('/donor-dispatches/:dispatchId/tracking/arrive', requireAuth, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await markDonorArrived({
      dispatchId,
      user: req.user,
      organization: req.organization
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Mark arrived failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to mark donor arrival' });
  }
});

router.post('/donor-dispatches/:dispatchId/tracking/complete', requireAuth, requireRole('HOSPITAL'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await completeDonorDispatch({
      dispatchId,
      user: req.user,
      organization: req.organization
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Complete dispatch failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID' || error.code === 'INVALID_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to complete donor dispatch' });
  }
});

router.post('/donor-dispatches/:dispatchId/withdraw', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const makeUnavailable = Boolean(req.body?.makeUnavailable);

    const result = await withdrawDonorDispatch({
      dispatchId,
      donorUserId: req.user.id,
      makeUnavailable
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Donor withdrawal failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to process donor withdrawal' });
  }
});

router.post('/donor-dispatches/:dispatchId/gps-timeout', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const result = await handleGpsTimeout({
      dispatchId,
      donorUserId: req.user.id
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('GPS timeout failed:', error);
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    if (error.code === 'INVALID_DISPATCH_ID') {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to handle GPS timeout' });
  }
});

router.post('/donor-dispatches/:dispatchId/eta-check', requireAuth, async (req, res) => {
  try {
    const { dispatchId } = req.params;
    if (!UUID_RE.test(dispatchId)) {
      return res.status(400).json({ error: 'INVALID_DISPATCH_ID', message: 'dispatchId must be a valid UUID' });
    }

    const { eta, maxThreshold } = req.body || {};
    if (eta === undefined || typeof eta !== 'number') {
      return res.status(400).json({ error: 'INVALID_ETA', message: 'eta must be a valid number' });
    }

    // Backend remains authoritative for threshold calculation
    const result = await handleEtaExceeded({
      dispatchId,
      eta,
      actorUserId: req.user.id
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('ETA check failed:', error);
    if (error.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    if (error.code === 'INVALID_STATE_TRANSITION') {
      return res.status(409).json({ error: 'INVALID_STATE_TRANSITION', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to process ETA check' });
  }
});

router.get('/donors/availability', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { data: donor, error: donorErr } = await supabaseAdmin
      .from('donors')
      .select('id, user_id, availability_status, eligibility_status')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (donorErr || !donor) {
      return res.status(404).json({ error: 'DONOR_NOT_FOUND', message: 'Donor profile not found' });
    }

    return res.status(200).json({
      donorId: donor.id,
      userId: donor.user_id,
      availabilityStatus: donor.availability_status,
      eligibilityStatus: donor.eligibility_status
    });
  } catch (error) {
    console.error('Get availability failed:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to get donor availability' });
  }
});

router.patch('/donors/availability', requireAuth, requireRole('DONOR'), async (req, res) => {
  try {
    const { availabilityStatus, confirmWithdraw } = req.body || {};
    if (!availabilityStatus || typeof availabilityStatus !== 'string') {
      return res.status(400).json({ error: 'INVALID_AVAILABILITY_STATUS', message: 'availabilityStatus is required' });
    }

    const result = await updateDonorAvailability({
      donorUserId: req.user.id,
      availabilityStatus,
      confirmWithdraw: Boolean(confirmWithdraw)
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Update availability failed:', error);
    if (error.code === 'ACTIVE_DISPATCH_CONFIRMATION_REQUIRED') {
      return res.status(409).json({
        error: 'ACTIVE_DISPATCH_CONFIRMATION_REQUIRED',
        message: 'You are currently assigned to an emergency request. Changing your availability will withdraw this assignment and allow another donor to be selected.'
      });
    }
    if (error.code === 'INVALID_AVAILABILITY_STATUS') {
      return res.status(400).json({ error: error.code, message: error.message });
    }
    if (error.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'FORBIDDEN', message: error.message });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to update donor availability' });
  }
});

export default router;
