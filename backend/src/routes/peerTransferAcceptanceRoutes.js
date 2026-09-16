import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { acceptPeerTransferOffer } from '../services/peerTransferAcceptanceService.js';

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/transfer-offers/:offerId/accept', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const { offerId } = req.params;
    if (!UUID_PATTERN.test(offerId)) {
      return res.status(400).json({ error: 'INVALID_OFFER_ID', message: 'offerId must be a valid UUID' });
    }

    const bloodBankId = req.organization?.bloodBankId;
    if (!bloodBankId) {
      return res.status(403).json({ error: 'BLOOD_BANK_NOT_PROVISIONED', message: 'No active blood-bank membership is associated with this account' });
    }

    const result = await acceptPeerTransferOffer({ offerId, bloodBankId });

    return res.status(200).json({
      offerId: result.offer_id,
      requestId: result.request_id,
      bloodBankId: result.blood_bank_id,
      reservedUnits: result.reserved_units,
      remainingRequestUnits: result.remaining_request_units,
      requestStatus: result.remaining_request_units === 0 ? 'FULFILLED' : 'PARTIALLY_FULFILLED'
    });
  } catch (error) {
    console.error('Peer transfer acceptance failed:', error);

    if (error.code === 'P0002') {
      return res.status(404).json({ error: 'TRANSFER_OFFER_NOT_FOUND', message: 'Transfer offer not found' });
    }
    if (error.code === '42501') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to accept this transfer offer' });
    }
    if (error.code === '22023') {
      return res.status(400).json({ error: 'INVALID_TRANSFER', message: error.message });
    }
    if (error.code === '55000' || error.code === '40001') {
      return res.status(409).json({ error: 'TRANSFER_CONFLICT', message: error.message });
    }

    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to accept peer blood-bank transfer offer' });
  }
});

export default router;
