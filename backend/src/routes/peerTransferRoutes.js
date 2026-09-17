import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { createPeerTransferOffers } from '../services/peerTransferService.js';

const router = express.Router();

router.post('/requests/:requestId/resolve/peer-banks', requireAuth, requireRole('HOSPITAL'), async (req, res) => {
  try {
    const { requestId } = req.params;
    if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST_ID', message: 'requestId must be a valid UUID' });
    }

    const hospitalId = req.organization?.hospitalId;
    if (!hospitalId) {
      return res.status(403).json({ error: 'HOSPITAL_NOT_PROVISIONED', message: 'No active hospital membership is associated with this account' });
    }

    const { data: request, error } = await supabaseAdmin
      .from('emergency_requests')
      .select('id, hospital_id, blood_group, quantity, resource_type, urgency, status, hospital_latitude, hospital_longitude, created_at')
      .eq('id', requestId)
      .maybeSingle();

    if (error) {
      console.error('Peer transfer request lookup failed:', error);
      return res.status(500).json({ error: 'DATABASE_ERROR', message: 'Failed to load emergency request' });
    }
    if (!request) return res.status(404).json({ error: 'REQUEST_NOT_FOUND', message: 'Emergency request not found' });
    if (request.hospital_id !== hospitalId) return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to resolve this emergency request' });
    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(request.status)) {
      return res.status(409).json({ error: 'REQUEST_NOT_OPEN', message: `Request cannot use peer-bank resolution from status '${request.status}'` });
    }

    const result = await createPeerTransferOffers({ request });

    return res.status(200).json({
      requestId: request.id,
      requestedUnits: request.quantity,
      remainingUnits: result.remainingUnits,
      fullySourced: result.remainingUnits === 0,
      offers: result.offers
    });
  } catch (error) {
    console.error('Peer bank resolution failed:', error);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to resolve peer blood-bank transfers' });
  }
});

export default router;
