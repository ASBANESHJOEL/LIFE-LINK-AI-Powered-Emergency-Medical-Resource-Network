import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { reserveBloodInventory } from '../services/inventoryService.js';

const router = express.Router();

/**
 * POST /api/requests/:requestId/resolve/inventory
 *
 * Hospital-only allocation step. The request identity and hospital ownership
 * are resolved from the authenticated user's organization membership.
 */
router.post('/requests/:requestId/resolve/inventory', requireAuth, requireRole('HOSPITAL'), async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST_ID', message: 'requestId must be a valid UUID' });
    }

    const hospitalId = req.organization?.hospitalId;
    if (!hospitalId) {
      return res.status(403).json({ error: 'HOSPITAL_NOT_PROVISIONED', message: 'No active hospital membership is associated with this account' });
    }

    const { data: request, error: requestError } = await supabaseAdmin
      .from('emergency_requests')
      .select('id, hospital_id, blood_group, quantity, resource_type, status, created_at')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      console.error('Inventory resolution request lookup failed:', requestError);
      return res.status(500).json({ error: 'DATABASE_ERROR', message: 'Failed to load emergency request' });
    }

    if (!request) {
      return res.status(404).json({ error: 'REQUEST_NOT_FOUND', message: 'Emergency request not found' });
    }

    if (request.hospital_id !== hospitalId) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to resolve this emergency request' });
    }

    if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(request.status)) {
      return res.status(409).json({ error: 'REQUEST_NOT_OPEN', message: `Request cannot be resolved from status '${request.status}'` });
    }

    const result = await reserveBloodInventory({
      requestId: request.id,
      bloodGroup: request.blood_group,
      componentType: request.resource_type,
      quantity: request.quantity
    });

    return res.status(200).json({
      requestId: request.id,
      requestedUnits: request.quantity,
      allocatedUnits: result.allocatedUnits,
      remainingUnits: result.remainingUnits,
      fullyReserved: result.fullyReserved,
      allocations: result.allocations
    });
  } catch (error) {
    console.error('Inventory resolution failed:', error);
    const status = ['P0002', '22023', '55000'].includes(error.code) ? 409 : 500;
    return res.status(status).json({
      error: status === 409 ? 'INVENTORY_RESOLUTION_CONFLICT' : 'INTERNAL_SERVER_ERROR',
      message: status === 409 ? error.message : 'Failed to resolve blood inventory'
    });
  }
});

export default router;
