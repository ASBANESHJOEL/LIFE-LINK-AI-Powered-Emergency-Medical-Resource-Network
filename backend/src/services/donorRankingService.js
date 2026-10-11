import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const TERMINAL_DISPATCH_STATUSES = new Set(['ACCEPTED', 'COMPLETED', 'DECLINED', 'NO_RESPONSE', 'CANCELLED']);
const POSITIVE_DISPATCH_STATUSES = new Set(['ACCEPTED', 'COMPLETED']);
const URGENCY_LEVEL = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const raw = [lat1, lon1, lat2, lon2];
  if (raw.some((value) => value === null || value === undefined || String(value).trim() === '')) return null;
  const values = raw.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [aLat, aLon, bLat, bLon] = values;
  if (Math.abs(aLat) > 90 || Math.abs(bLat) > 90 || Math.abs(aLon) > 180 || Math.abs(bLon) > 180) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLon = radians(bLon - aLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function buildRankingFeatures({ donor, request, historyRows, distanceKm }) {
  const history = (historyRows || []).filter((row) => TERMINAL_DISPATCH_STATUSES.has(row.status));
  const positives = history.filter((row) => POSITIVE_DISPATCH_STATUSES.has(row.status)).length;
  const dispatchDate = new Date(request.created_at);
  const lastDonation = donor.lastDonationDate ? new Date(donor.lastDonationDate) : null;
  const daysSinceDonation = lastDonation && Number.isFinite(lastDonation.getTime())
    ? Math.max(0, (dispatchDate.getTime() - lastDonation.getTime()) / 86400000)
    : 3650;
  const hour = dispatchDate.getUTCHours();
  const day = (dispatchDate.getUTCDay() + 6) % 7;
  const urgency = URGENCY_LEVEL[String(request.urgency || '').toUpperCase()];
  if (!Number.isFinite(dispatchDate.getTime()) || urgency === undefined) {
    throw new Error('Request is missing a valid created_at timestamp or urgency value');
  }
  const donorGroup = String(donor.bloodGroup || '').toUpperCase();
  return {
    is_exact_blood_match: Number(donorGroup === String(request.blood_group || '').toUpperCase()),
    is_blood_compatible: 1,
    is_universal_donor: Number(donorGroup === 'O_NEGATIVE'),
    donor_is_verified: Number(donor.verified === true),
    donor_is_eligible: Number(donor.eligibilityStatus === 'ELIGIBLE'),
    donor_is_available: Number(donor.availabilityStatus === 'AVAILABLE'),
    donor_response_rate: (positives + 2) / (history.length + 4),
    donor_history_count: history.length,
    donor_positive_responses: positives,
    days_since_last_donation: daysSinceDonation,
    dispatch_hour: hour,
    dispatch_day_of_week: day,
    is_weekend: Number(day >= 5),
    is_night_dispatch: Number(hour >= 22 || hour < 6),
    is_business_hours: Number(day < 5 && hour >= 9 && hour < 18),
    requested_quantity: Number(request.quantity),
    urgency_level: urgency,
    is_resource_blood: Number(['WHOLE_BLOOD', 'RED_BLOOD_CELLS'].includes(request.resource_type)),
    distance_km: distanceKm,
  };
}

export async function rankEligibleDonors({ request, donors }) {
  if (process.env.ML_RANKING_ENABLED !== 'true') {
    return { status: 'DISABLED', message: 'ML ranking is disabled; returning eligibility-filtered candidates.' };
  }
  const baseUrl = String(process.env.ML_API_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.ML_RANKING_API_KEY;
  if (!baseUrl || !apiKey) {
    return { status: 'UNAVAILABLE', message: 'ML ranking configuration is incomplete; returning eligibility-filtered candidates.' };
  }
  if (!donors.length) return { status: 'RANKED', model: 'donor_ranker_mlp_v2', donors: [] };
  if (!request.created_at || request.hospital_latitude == null || request.hospital_longitude == null) {
    return { status: 'UNAVAILABLE', message: 'Request location or timestamp is unavailable; returning eligibility-filtered candidates.' };
  }
  const located = donors.map((donor) => ({
    donor,
    distanceKm: calculateDistanceKm(request.hospital_latitude, request.hospital_longitude,
      donor.currentLatitude, donor.currentLongitude),
  }));
  if (located.some((item) => item.distanceKm == null)) {
    return { status: 'UNAVAILABLE', message: 'One or more candidates lack usable location data; returning eligibility-filtered candidates.' };
  }

  const donorIds = donors.map((donor) => donor.donorId);
  let historyRows;
  try {
    const result = await supabaseAdmin
      .from('donor_dispatches')
      .select('donor_id, status, created_at')
      .in('donor_id', donorIds)
      .lt('created_at', request.created_at)
      .limit(10000);
    if (result.error) {
      return { status: 'UNAVAILABLE', message: 'Historical dispatch features could not be loaded; returning eligibility-filtered candidates.' };
    }
    historyRows = result.data || [];
  } catch {
    return { status: 'UNAVAILABLE', message: 'Historical dispatch lookup failed; returning eligibility-filtered candidates.' };
  }

  const byDonor = new Map(donorIds.map((id) => [id, []]));
  for (const row of historyRows) {
    if (byDonor.has(row.donor_id)) byDonor.get(row.donor_id).push(row);
  }
  const candidates = located.map(({ donor, distanceKm }) => ({
    donor_id: donor.donorId,
    distance_km: Number(distanceKm.toFixed(3)),
    features: buildRankingFeatures({ donor, request, historyRows: byDonor.get(donor.donorId), distanceKm }),
  }));

  try {
    const response = await fetch(`${baseUrl}/rank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ candidates }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { status: 'UNAVAILABLE', message: `ML ranking service returned HTTP ${response.status}; returning eligibility-filtered candidates.` };
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Unexpected ML ranking response');
    const allowedIds = new Set(donorIds);
    const seenIds = new Set();
    for (const item of payload) {
      if (!item || !allowedIds.has(item.donor_id) || seenIds.has(item.donor_id)
        || !Number.isInteger(item.rank) || item.rank < 1 || !Number.isFinite(item.score)) {
        throw new Error('Invalid ML ranking item');
      }
      seenIds.add(item.donor_id);
    }
    const donorById = new Map(donors.map((donor) => [donor.donorId, donor]));
    const ranked = [...payload]
      .sort((a, b) => a.rank - b.rank)
      .map((item) => ({ ...donorById.get(item.donor_id), ranking: { rank: item.rank, score: item.score } }));
    return { status: 'RANKED', model: 'donor_ranker_mlp_v2', donors: ranked };
  } catch {
    return { status: 'UNAVAILABLE', message: 'ML ranking request failed; returning eligibility-filtered candidates.' };
  }
}
