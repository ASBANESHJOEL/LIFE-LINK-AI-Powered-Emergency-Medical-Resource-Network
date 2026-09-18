import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { rankEligibleDonors } from '../services/donorRankingService.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get('/requests/:requestId/donor-ranking', requireAuth, requireRole('HOSPITAL'), async (req, res) => {
  try {
    const hospitalId = req.organization?.hospitalId;
    if (!hospitalId) {
      return res.status(403).json({ error: 'HOSPITAL_NOT_PROVISIONED', message: 'No active hospital organization is associated with this account' });
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
    if (request.hospital_id !== hospitalId) return res.status(403).json({ error: 'FORBIDDEN', message: 'Emergency request does not belong to this hospital' });
    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(request.status)) {
      return res.status(409).json({ error: 'REQUEST_NOT_OPEN', message: 'Donor ranking is only available for open or partially fulfilled requests' });
    }

    const requestedLimit = Number(req.query.limit ?? 100);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 100;
    const result = await rankEligibleDonors({ request, limit, batchSize: 5 });

    return res.json({
      requestId: request.id,
      requestedUnits: request.quantity,
      urgency: request.urgency,
      candidateCount: result.candidateCount,
      modelVersion: result.modelVersion,
      rankedDonors: result.rankedDonors,
      nextBatch: result.nextBatch,
      batchSize: result.nextBatch.length
    });
  } catch (error) {
    console.error('Donor ranking failed:', error);
    if (['ML_NOT_CONFIGURED', 'ML_TIMEOUT', 'ML_INFERENCE_FAILED'].includes(error.code)) {
      return res.status(503).json({ error: 'ML_SERVICE_UNAVAILABLE', message: 'Donor ranking service is temporarily unavailable' });
    }
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to rank eligible donor candidates' });
  }
});

export default router;
