import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const COMPATIBLE_DONOR_GROUPS = {
  RED_BLOOD_CELLS: {
    A_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    A_NEGATIVE: new Set(['A_NEGATIVE', 'O_NEGATIVE']),
    B_POSITIVE: new Set(['B_POSITIVE', 'B_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    B_NEGATIVE: new Set(['B_NEGATIVE', 'O_NEGATIVE']),
    AB_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    AB_NEGATIVE: new Set(['A_NEGATIVE', 'B_NEGATIVE', 'AB_NEGATIVE', 'O_NEGATIVE']),
    O_POSITIVE: new Set(['O_POSITIVE', 'O_NEGATIVE']),
    O_NEGATIVE: new Set(['O_NEGATIVE'])
  },
  WHOLE_BLOOD: {
    A_POSITIVE: new Set(['A_POSITIVE']),
    A_NEGATIVE: new Set(['A_NEGATIVE']),
    B_POSITIVE: new Set(['B_POSITIVE']),
    B_NEGATIVE: new Set(['B_NEGATIVE']),
    AB_POSITIVE: new Set(['AB_POSITIVE']),
    AB_NEGATIVE: new Set(['AB_NEGATIVE']),
    O_POSITIVE: new Set(['O_POSITIVE']),
    O_NEGATIVE: new Set(['O_NEGATIVE'])
  },
  PLASMA: {
    A_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE']),
    A_NEGATIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE']),
    B_POSITIVE: new Set(['B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE']),
    B_NEGATIVE: new Set(['B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE']),
    AB_POSITIVE: new Set(['AB_POSITIVE', 'AB_NEGATIVE']),
    AB_NEGATIVE: new Set(['AB_POSITIVE', 'AB_NEGATIVE']),
    O_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    O_NEGATIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE'])
  },
  PLATELETS: {
    A_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    A_NEGATIVE: new Set(['A_NEGATIVE', 'O_NEGATIVE']),
    B_POSITIVE: new Set(['B_POSITIVE', 'B_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    B_NEGATIVE: new Set(['B_NEGATIVE', 'O_NEGATIVE']),
    AB_POSITIVE: new Set(['A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE']),
    AB_NEGATIVE: new Set(['A_NEGATIVE', 'B_NEGATIVE', 'AB_NEGATIVE', 'O_NEGATIVE']),
    O_POSITIVE: new Set(['O_POSITIVE', 'O_NEGATIVE']),
    O_NEGATIVE: new Set(['O_NEGATIVE'])
  }
};

const SUPPORTED_COMPONENTS = new Set(Object.keys(COMPATIBLE_DONOR_GROUPS));

export function isCompatibleDonor({ donorBloodGroup, recipientBloodGroup, componentType }) {
  if (!SUPPORTED_COMPONENTS.has(componentType)) return false;
  return COMPATIBLE_DONOR_GROUPS[componentType][recipientBloodGroup]?.has(donorBloodGroup) ?? false;
}

export async function findEligibleDonors({ requestId, bloodGroup, componentType, limit = 100 }) {
  const { data: donors, error: donorError } = await supabaseAdmin
    .from('donors')
    .select('id, user_id, name, blood_group, availability_status, eligibility_status, last_donation_date, live_location_enabled, verified, current_latitude, current_longitude')
    .eq('verified', true)
    .eq('eligibility_status', 'ELIGIBLE')
    .eq('availability_status', 'AVAILABLE')
    .limit(Math.min(limit, 500));

  if (donorError) {
    const error = new Error(donorError.message || 'Failed to retrieve eligible donors');
    error.code = donorError.code;
    throw error;
  }

  if (!donors?.length) return [];

  const { data: dispatched, error: dispatchError } = await supabaseAdmin
    .from('donor_dispatches')
    .select('donor_id')
    .eq('request_id', requestId)
    .in('status', ['PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED']);

  if (dispatchError) {
    const error = new Error(dispatchError.message || 'Failed to check existing donor dispatches');
    error.code = dispatchError.code;
    throw error;
  }

  const alreadyDispatched = new Set((dispatched || []).map((row) => row.donor_id));

  return donors
    .filter((donor) => !alreadyDispatched.has(donor.id))
    .filter((donor) => isCompatibleDonor({
      donorBloodGroup: donor.blood_group,
      recipientBloodGroup: bloodGroup,
      componentType
    }))
    .map((donor) => ({
      donorId: donor.id,
      userId: donor.user_id,
      name: donor.name,
      bloodGroup: donor.blood_group,
      availabilityStatus: donor.availability_status,
      eligibilityStatus: donor.eligibility_status,
      verified: donor.verified,
      lastDonationDate: donor.last_donation_date,
      liveLocationEnabled: donor.live_location_enabled,
      currentLatitude: donor.current_latitude,
      currentLongitude: donor.current_longitude
    }));
}
