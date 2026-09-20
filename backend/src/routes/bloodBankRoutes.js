import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOOD_GROUPS = ['A_POSITIVE','A_NEGATIVE','B_POSITIVE','B_NEGATIVE','AB_POSITIVE','AB_NEGATIVE','O_POSITIVE','O_NEGATIVE'];
const COMPONENTS = ['WHOLE_BLOOD','RED_BLOOD_CELLS','PLASMA','PLATELETS'];
const PRIORITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];

function bloodBankId(req) {
  const id = req.organization?.bloodBankId;
  if (!id || !UUID_RE.test(id)) {
    const err = new Error('No active blood-bank organization is associated with this account');
    err.code = 'BLOOD_BANK_NOT_PROVISIONED';
    throw err;
  }
  return id;
}

router.get('/blood-bank/inventory', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const id = bloodBankId(req);
    const { data, error } = await supabaseAdmin
      .from('blood_inventory')
      .select('*')
      .eq('blood_bank_id', id)
      .order('expiry_date', { ascending: true });
    if (error) throw error;
    return res.json({ inventory: data || [] });
  } catch (error) {
    return res.status(error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? 403 : 500).json({
      error: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? error.message : 'Failed to load blood-bank inventory'
    });
  }
});

router.post('/blood-bank/inventory/lots', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const bankId = bloodBankId(req);
    const { bloodGroup, componentType, units, criticalLevel = 0, expiryDate } = req.body || {};
    if (!BLOOD_GROUPS.includes(bloodGroup) || !COMPONENTS.includes(componentType)) {
      return res.status(400).json({ error: 'INVALID_INVENTORY_TYPE', message: 'Invalid blood group or component type' });
    }
    const parsedUnits = Number(units);
    const parsedCritical = Number(criticalLevel);
    if (!Number.isInteger(parsedUnits) || parsedUnits <= 0 || !Number.isInteger(parsedCritical) || parsedCritical < 0) {
      return res.status(400).json({ error: 'INVALID_UNITS', message: 'Units must be a positive integer and critical level must be a non-negative integer' });
    }
    const expiry = new Date(expiryDate);
    if (!expiryDate || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      return res.status(400).json({ error: 'INVALID_EXPIRY', message: 'Expiry date must be a valid future date' });
    }

    const { data, error } = await supabaseAdmin
      .from('blood_inventory')
      .insert({
        blood_bank_id: bankId,
        blood_group: bloodGroup,
        component_type: componentType,
        available_units: parsedUnits,
        reserved_units: 0,
        critical_level: parsedCritical,
        expiry_date: expiry.toISOString(),
        last_updated: new Date().toISOString(),
        is_synthetic: false
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json({ inventory: data });
  } catch (error) {
    return res.status(error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? 403 : 500).json({
      error: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? error.message : 'Failed to add inventory lot'
    });
  }
});

router.patch('/blood-bank/inventory/:inventoryId', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const bankId = bloodBankId(req);
    const { inventoryId } = req.params;
    if (!UUID_RE.test(inventoryId)) return res.status(400).json({ error: 'INVALID_INVENTORY_ID', message: 'inventoryId must be a valid UUID' });

    const { deltaUnits, criticalLevel, expiryDate } = req.body || {};
    const { data: lot, error: lookupError } = await supabaseAdmin
      .from('blood_inventory')
      .select('id, blood_bank_id, available_units, reserved_units, critical_level, expiry_date')
      .eq('id', inventoryId)
      .eq('blood_bank_id', bankId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!lot) return res.status(404).json({ error: 'INVENTORY_NOT_FOUND', message: 'Inventory lot not found' });

    const updates = { last_updated: new Date().toISOString() };
    if (deltaUnits !== undefined) {
      const delta = Number(deltaUnits);
      if (!Number.isInteger(delta) || delta === 0) return res.status(400).json({ error: 'INVALID_DELTA', message: 'deltaUnits must be a non-zero integer' });
      const nextAvailable = Number(lot.available_units) + delta;
      if (nextAvailable < 0 || nextAvailable < Number(lot.reserved_units)) {
        return res.status(409).json({ error: 'INVENTORY_BELOW_RESERVED', message: 'Available units cannot fall below reserved units' });
      }
      updates.available_units = nextAvailable;
    }
    if (criticalLevel !== undefined) {
      const value = Number(criticalLevel);
      if (!Number.isInteger(value) || value < 0) return res.status(400).json({ error: 'INVALID_CRITICAL_LEVEL', message: 'criticalLevel must be a non-negative integer' });
      updates.critical_level = value;
    }
    if (expiryDate !== undefined) {
      const expiry = new Date(expiryDate);
      if (Number.isNaN(expiry.getTime()) || expiry <= new Date()) return res.status(400).json({ error: 'INVALID_EXPIRY', message: 'Expiry date must be a valid future date' });
      updates.expiry_date = expiry.toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('blood_inventory')
      .update(updates)
      .eq('id', inventoryId)
      .eq('blood_bank_id', bankId)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ inventory: data });
  } catch (error) {
    return res.status(error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? 403 : 500).json({
      error: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? error.message : 'Failed to update inventory lot'
    });
  }
});

router.get('/blood-bank/refill-requests', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const bankId = bloodBankId(req);
    const { data, error } = await supabaseAdmin
      .from('refill_requests')
      .select('*')
      .eq('blood_bank_id', bankId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ requests: data || [] });
  } catch (error) {
    return res.status(error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? 403 : 500).json({
      error: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? error.message : 'Failed to load refill requests'
    });
  }
});

router.post('/blood-bank/refill-requests', requireAuth, requireRole('BLOOD_BANK'), async (req, res) => {
  try {
    const bankId = bloodBankId(req);
    const { bloodGroup, componentType, requiredUnits, priority } = req.body || {};
    if (!BLOOD_GROUPS.includes(bloodGroup) || !COMPONENTS.includes(componentType) || !PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'INVALID_REFILL_REQUEST', message: 'Invalid blood group, component or priority' });
    }
    const units = Number(requiredUnits);
    if (!Number.isInteger(units) || units <= 0) return res.status(400).json({ error: 'INVALID_UNITS', message: 'requiredUnits must be a positive integer' });

    const { data, error } = await supabaseAdmin
      .from('refill_requests')
      .insert({
        blood_bank_id: bankId,
        blood_group: bloodGroup,
        component_type: componentType,
        required_units: units,
        priority,
        status: 'OPEN',
        is_synthetic: false
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json({ request: data });
  } catch (error) {
    return res.status(error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? 403 : 500).json({
      error: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.code === 'BLOOD_BANK_NOT_PROVISIONED' ? error.message : 'Failed to create refill request'
    });
  }
});

export default router;
