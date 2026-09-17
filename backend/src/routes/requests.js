import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const router = Router();

const BLOOD_GROUPS = new Set([
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE'
]);

const COMPONENT_TYPES = new Set([
  'WHOLE_BLOOD',
  'RED_BLOOD_CELLS',
  'PLASMA',
  'PLATELETS'
]);

const URGENCY_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * POST /api/requests
 *
 * Creates an emergency blood request for the authenticated hospital.
 * Hospital identity is derived from trusted organization membership; the
 * client cannot choose another hospital_id.
 *
 * Inventory reservation is intentionally not performed in this handler yet.
 * The next resolution layer will perform atomic inventory/peer-bank
 * allocation so a request cannot oversell stock under concurrent requests.
 */
router.post('/', async (req, res) => {
  try {
    if (req.user?.role !== 'HOSPITAL') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only authenticated hospital users can create emergency requests'
      });
    }

    const hospitalId = req.organization?.hospitalId;
    if (!hospitalId) {
      return res.status(403).json({
        error: 'HOSPITAL_NOT_PROVISIONED',
        message: 'No active hospital organization is associated with this account'
      });
    }

    const { blood_group, quantity, resource_type = 'WHOLE_BLOOD', urgency, hospital_latitude, hospital_longitude } = req.body ?? {};

    if (typeof blood_group !== 'string' || !BLOOD_GROUPS.has(blood_group)) {
      return res.status(400).json({
        error: 'INVALID_BLOOD_GROUP',
        message: 'blood_group must be one of the supported LIFE-LINK blood-group values'
      });
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return res.status(400).json({
        error: 'INVALID_QUANTITY',
        message: 'quantity must be an integer between 1 and 1000'
      });
    }

    if (typeof resource_type !== 'string' || !COMPONENT_TYPES.has(resource_type)) {
      return res.status(400).json({
        error: 'INVALID_RESOURCE_TYPE',
        message: 'resource_type must be one of WHOLE_BLOOD, RED_BLOOD_CELLS, PLASMA, PLATELETS'
      });
    }

    if (typeof urgency !== 'string' || !URGENCY_LEVELS.has(urgency)) {
      return res.status(400).json({
        error: 'INVALID_URGENCY',
        message: 'urgency must be one of LOW, MEDIUM, HIGH, CRITICAL'
      });
    }

    const hasLatitude = hospital_latitude !== undefined && hospital_latitude !== null;
    const hasLongitude = hospital_longitude !== undefined && hospital_longitude !== null;

    if (hasLatitude !== hasLongitude) {
      return res.status(400).json({
        error: 'INVALID_LOCATION',
        message: 'hospital_latitude and hospital_longitude must be provided together'
      });
    }

    if (hasLatitude && (!isFiniteNumber(hospital_latitude) || hospital_latitude < -90 || hospital_latitude > 90)) {
      return res.status(400).json({
        error: 'INVALID_LATITUDE',
        message: 'hospital_latitude must be a number between -90 and 90'
      });
    }

    if (hasLongitude && (!isFiniteNumber(hospital_longitude) || hospital_longitude < -180 || hospital_longitude > 180)) {
      return res.status(400).json({
        error: 'INVALID_LONGITUDE',
        message: 'hospital_longitude must be a number between -180 and 180'
      });
    }

    // Defense-in-depth: verify the hospital exists and is institutionally verified.
    const { data: hospital, error: hospitalError } = await supabaseAdmin
      .from('hospitals')
      .select('id, hospital_name, registration_id, verified')
      .eq('id', hospitalId)
      .maybeSingle();

    if (hospitalError) {
      console.error('Hospital lookup failed:', hospitalError);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Failed to verify hospital organization'
      });
    }

    if (!hospital) {
      return res.status(403).json({
        error: 'HOSPITAL_NOT_FOUND',
        message: 'The authenticated hospital organization could not be resolved'
      });
    }

    if (hospital.verified !== true) {
      return res.status(403).json({
        error: 'HOSPITAL_NOT_VERIFIED',
        message: 'Only verified hospital institutions can create emergency requests'
      });
    }

    const insertPayload = {
      hospital_id: hospital.id,
      blood_group,
      quantity,
      resource_type,
      urgency,
      ...(hasLatitude ? { hospital_latitude, hospital_longitude } : {})
    };

    const { data: request, error: requestError } = await supabaseAdmin
      .from('emergency_requests')
      .insert(insertPayload)
      .select('id, hospital_id, blood_group, quantity, resource_type, urgency, status, hospital_latitude, hospital_longitude, is_synthetic, created_at, completed_at')
      .single();

    if (requestError) {
      console.error('Emergency request creation failed:', requestError);
      return res.status(500).json({
        error: 'REQUEST_CREATION_FAILED',
        message: 'Failed to create emergency request'
      });
    }

    return res.status(201).json({
      request,
      hospital: {
        id: hospital.id,
        name: hospital.hospital_name,
        registrationId: hospital.registration_id,
        verified: hospital.verified
      },
      resolution: {
        status: 'PENDING',
        message: 'Emergency request created. Resource resolution will run through the inventory-first orchestration layer.'
      }
    });
  } catch (error) {
    console.error('Unexpected emergency request error:', error);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while creating the emergency request'
    });
  }
});

export default router;
