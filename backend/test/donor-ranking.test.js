import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';

const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const { rankEligibleDonors, buildRankingFeatures } = await import('../src/services/donorRankingService.js');

const originalFrom = supabaseAdmin.from;
const originalFetch = globalThis.fetch;
const originalEnv = {
  enabled: process.env.ML_RANKING_ENABLED,
  url: process.env.ML_API_URL,
  key: process.env.ML_RANKING_API_KEY,
};
let historyRows = [];
let historyError = null;
let fetchHandler;

function reset() {
  historyRows = [];
  historyError = null;
  fetchHandler = async () => ({ ok: true, status: 200, json: async () => [] });
  process.env.ML_RANKING_ENABLED = 'true';
  process.env.ML_API_URL = 'https://ml.example.test';
  process.env.ML_RANKING_API_KEY = 'test-only-key';
  supabaseAdmin.from = (table) => {
    assert.equal(table, 'donor_dispatches');
    const query = {
      select: () => query,
      in: () => query,
      lt: () => query,
      limit: () => query,
      then: (resolve, reject) => Promise.resolve(
        historyError ? { data: null, error: historyError } : { data: historyRows, error: null },
      ).then(resolve, reject),
    };
    return query;
  };
  globalThis.fetch = (...args) => fetchHandler(...args);
}

const request = {
  id: 'req-00000000-0000-4000-8000-000000000001',
  blood_group: 'O_POSITIVE',
  resource_type: 'WHOLE_BLOOD',
  quantity: 2,
  urgency: 'HIGH',
  created_at: '2026-09-01T12:00:00.000Z',
  hospital_latitude: 12.9716,
  hospital_longitude: 77.5946,
};

const donor = (donorId, overrides = {}) => ({
  donorId,
  userId: `user-${donorId}`,
  name: `Donor ${donorId}`,
  bloodGroup: 'O_POSITIVE',
  availabilityStatus: 'AVAILABLE',
  eligibilityStatus: 'ELIGIBLE',
  verified: true,
  lastDonationDate: '2026-01-01',
  currentLatitude: 12.9717,
  currentLongitude: 77.5947,
  ...overrides,
});

test.after(() => {
  supabaseAdmin.from = originalFrom;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    ML_RANKING_ENABLED: originalEnv.enabled,
    ML_API_URL: originalEnv.url,
    ML_RANKING_API_KEY: originalEnv.key,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('ranking stays disabled unless explicitly enabled', async () => {
  reset();
  process.env.ML_RANKING_ENABLED = 'false';
  const result = await rankEligibleDonors({ request, donors: [donor('d1')] });
  assert.equal(result.status, 'DISABLED');
  assert.equal(result.donors, undefined);
});

test('missing ML configuration safely returns UNAVAILABLE', async () => {
  reset();
  delete process.env.ML_API_URL;
  const result = await rankEligibleDonors({ request, donors: [donor('d1')] });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.message, /configuration is incomplete/i);
});

test('empty eligible candidate list returns an empty ranked list without calling ML', async () => {
  reset();
  fetchHandler = async () => { throw new Error('must not call ML for no candidates'); };
  const result = await rankEligibleDonors({ request, donors: [] });
  assert.equal(result.status, 'RANKED');
  assert.deepEqual(result.donors, []);
});

test('missing request coordinates safely disables ML ranking for this request', async () => {
  reset();
  const result = await rankEligibleDonors({
    request: { ...request, hospital_latitude: null },
    donors: [donor('d1')],
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.message, /location or timestamp/i);
});

test('valid ML response ranks only known donors and preserves eligibility-filtered donor fields', async () => {
  reset();
  fetchHandler = async (url, options) => {
    assert.equal(url, 'https://ml.example.test/rank');
    assert.equal(options.headers.authorization, 'Bearer test-only-key');
    const body = JSON.parse(options.body);
    assert.equal(body.candidates.length, 2);
    assert.equal(body.candidates[0].donor_id, 'd1');
    assert.ok(Number.isFinite(body.candidates[0].features.distance_km));
    return {
      ok: true,
      status: 200,
      json: async () => [
        { donor_id: 'd2', rank: 1, score: 0.8 },
        { donor_id: 'd1', rank: 2, score: 0.3 },
      ],
    };
  };
  const result = await rankEligibleDonors({ request, donors: [donor('d1'), donor('d2')] });
  assert.equal(result.status, 'RANKED');
  assert.equal(result.model, 'donor_ranker_mlp_v2');
  assert.deepEqual(result.donors.map((item) => item.donorId), ['d2', 'd1']);
  assert.equal(result.donors[0].name, 'Donor d2');
  assert.deepEqual(result.donors[0].ranking, { rank: 1, score: 0.8 });
});

test('malformed ML response falls back safely instead of inventing ranked candidates', async () => {
  reset();
  fetchHandler = async () => ({
    ok: true,
    status: 200,
    json: async () => [{ donor_id: 'unknown-donor', rank: 1, score: 0.9 }],
  });
  const result = await rankEligibleDonors({ request, donors: [donor('d1')] });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.message, /request failed/i);
});

test('ML HTTP failure returns UNAVAILABLE and leaves eligibility filtering upstream intact', async () => {
  reset();
  fetchHandler = async () => ({ ok: false, status: 503 });
  const result = await rankEligibleDonors({ request, donors: [donor('d1')] });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.message, /HTTP 503/i);
});

test('history query errors return UNAVAILABLE without calling ML', async () => {
  reset();
  historyError = new Error('history unavailable');
  fetchHandler = async () => { throw new Error('must not call ML after history failure'); };
  const result = await rankEligibleDonors({ request, donors: [donor('d1')] });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.message, /historical dispatch features/i);
});

test('feature builder maps urgency, response history, and location distance', () => {
  const features = buildRankingFeatures({
    donor: donor('d1'),
    request,
    historyRows: [
      { status: 'ACCEPTED' },
      { status: 'COMPLETED' },
      { status: 'DECLINED' },
      { status: 'PENDING' },
    ],
    distanceKm: 1.25,
  });
  assert.equal(features.urgency_level, 2);
  assert.equal(features.donor_history_count, 3);
  assert.equal(features.donor_positive_responses, 2);
  assert.equal(features.distance_km, 1.25);
  assert.equal(features.is_exact_blood_match, 1);
});
