import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { findEligibleDonors } from '../services/donorEligibilityService.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPONENT_TYPES = new Set(['WHOLE_BLOOD', 'RED_BLOOD_CELLS', 'PLASMA', 'PLATELETS']);

router.get('/requests/:requestId/eligible-donors', async (req, res) => {
  try {
    if (req.user?.role !== 'HOSPITAL') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Only authenticated hospital users can retrieve donor candidates' });
    }

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
      return res.status(409).json({ error: 'REQUEST_NOT_OPEN', message: 'Donor recruitment is only available for open or partially fulfilled requests' });
    }
    if (!COMPONENT_TYPES.has(request.resource_type)) {
      return res.status(422).json({ error: 'UNSUPPORTED_RESOURCE_TYPE', message: 'This request resource type is not supported by donor recruitment' });
    }

    const requestedLimit = Number(req.query.limit ?? 100);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 100;
    const donors = await findEligibleDonors({
      requestId: request.id,
      bloodGroup: request.blood_group,
      componentType: request.resource_type,
      limit
    });

    return res.json({
      requestId: request.id,
      requestedUnits: request.quantity,
      urgency: request.urgency,
      candidateCount: donors.length,
      donors,
      ranking: { status: 'NOT_RANKED', message: 'Candidates are eligibility-filtered only; ML ranking is a separate downstream stage.' }
    });
  } catch (error) {
    console.error('Eligible donor lookup failed:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to retrieve eligible donor candidates' });
  }
});

export default router;
