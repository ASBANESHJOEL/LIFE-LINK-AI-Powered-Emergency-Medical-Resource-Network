import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { findEligibleDonors } from './donorEligibilityService.js';

const URGENCY_LEVEL = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const UNIVERSAL_DONOR_GROUP = 'O_NEGATIVE';
const DEFAULT_BATCH_SIZE = 5;
const INFERENCE_CONCURRENCY = 8;

function getMlApiUrl() {
  return (process.env.ML_API_URL || '').replace(/\/$/, '');
}

function daysSince(dateValue) {
  if (!dateValue) return 365;
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 365;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function isUniversalDonor({ bloodGroup, componentType }) {
  return componentType === 'RED_BLOOD_CELLS' && bloodGroup === UNIVERSAL_DONOR_GROUP;
}

function buildFeatureVector({ donor, request, historyCount, positiveResponses }) {
  const now = new Date();
  const dispatchHour = now.getUTCHours();
  const dispatchDayOfWeek = now.getUTCDay();
  const isWeekend = dispatchDayOfWeek === 0 || dispatchDayOfWeek === 6;
  const isNightDispatch = dispatchHour < 6 || dispatchHour >= 22;
  const isBusinessHours = dispatchHour >= 9 && dispatchHour < 18 && !isWeekend;

  return {
    is_exact_blood_match: Number(donor.bloodGroup === request.blood_group),
    is_blood_compatible: 1,
    is_universal_donor: Number(isUniversalDonor({ bloodGroup: donor.bloodGroup, componentType: request.resource_type })),
    donor_is_verified: Number(donor.verified),
    donor_is_eligible: Number(donor.eligibilityStatus === 'ELIGIBLE'),
    donor_is_available: Number(donor.availabilityStatus === 'AVAILABLE'),
    donor_response_rate: historyCount > 0 ? positiveResponses / historyCount : 0,
    donor_history_count: historyCount,
    donor_positive_responses: positiveResponses,
    days_since_last_donation: daysSince(donor.lastDonationDate),
    dispatch_hour: dispatchHour,
    dispatch_day_of_week: dispatchDayOfWeek,
    is_weekend: Number(isWeekend),
    is_night_dispatch: Number(isNightDispatch),
    is_business_hours: Number(isBusinessHours),
    requested_quantity: Number(request.quantity),
    urgency_level: URGENCY_LEVEL[request.urgency] ?? 1,
    is_resource_blood: 1
  };
}

async function getDonorHistory(donorIds, requestId) {
  if (!donorIds.length) return new Map();

  const { data, error } = await supabaseAdmin
    .from('donor_dispatches')
    .select('donor_id, status')
    .in('donor_id', donorIds)
    .neq('request_id', requestId);

  if (error) {
    const err = new Error(error.message || 'Failed to retrieve donor response history');
    err.code = error.code;
    throw err;
  }

  const history = new Map();
  for (const row of data || []) {
    const current = history.get(row.donor_id) || { historyCount: 0, positiveResponses: 0 };
    current.historyCount += 1;
    if (['RESPONDED', 'ACCEPTED', 'COMPLETED'].includes(row.status)) current.positiveResponses += 1;
    history.set(row.donor_id, current);
  }
  return history;
}

async function predict(features) {
  const mlApiUrl = getMlApiUrl();
  if (!mlApiUrl) {
    const err = new Error('ML_API_URL is not configured');
    err.code = 'ML_NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${mlApiUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
      signal: controller.signal
    });
    if (!response.ok) {
      const err = new Error(`ML inference returned HTTP ${response.status}`);
      err.code = 'ML_INFERENCE_FAILED';
      throw err;
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      const err = new Error('ML inference timed out');
      err.code = 'ML_TIMEOUT';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, worker, concurrency = INFERENCE_CONCURRENCY) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

export async function rankEligibleDonors({ request, limit = 500, batchSize = DEFAULT_BATCH_SIZE }) {
  const donors = await findEligibleDonors({
    requestId: request.id,
    bloodGroup: request.blood_group,
    componentType: request.resource_type,
    limit
  });

  if (!donors.length) {
    return { modelVersion: null, candidateCount: 0, rankedDonors: [], nextBatch: [] };
  }

  const history = await getDonorHistory(donors.map((donor) => donor.donorId), request.id);
  const ranked = await mapWithConcurrency(donors, async (donor) => {
    const donorHistory = history.get(donor.donorId) || { historyCount: 0, positiveResponses: 0 };
    const features = buildFeatureVector({ donor, request, ...donorHistory });
    const prediction = await predict(features);
    return {
      ...donor,
      responseProbability: prediction.probability,
      predictedResponse: prediction.prediction,
      modelVersion: prediction.model_version
    };
  });

  ranked.sort((a, b) => {
    if (b.responseProbability !== a.responseProbability) return b.responseProbability - a.responseProbability;
    return a.donorId.localeCompare(b.donorId);
  });

  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 5) : DEFAULT_BATCH_SIZE;
  return {
    modelVersion: ranked[0]?.modelVersion || null,
    candidateCount: ranked.length,
    rankedDonors: ranked,
    nextBatch: ranked.slice(0, safeBatchSize)
  };
}
