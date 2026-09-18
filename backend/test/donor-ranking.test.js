import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';
process.env.ML_API_URL = 'http://ml.internal:8000';

const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const { rankEligibleDonors } = await import('../src/services/donorRankingService.js');

// Save original supabase methods
const originalFrom = supabaseAdmin.from;
const originalFetch = globalThis.fetch;

// Test DB Mock State
let mockDonors = [];
let mockDispatches = [];
let mockDonorsError = null;
let mockDispatchesError = null;
let mockMlBehavior = 'SUCCESS'; // 'SUCCESS' | 'NOT_CONFIGURED' | 'TIMEOUT' | 'INFERENCE_FAILED'
let mockMlPredictions = new Map();
let mockMlCustomHandler = null;

function resetMocks() {
  mockDonors = [];
  mockDispatches = [];
  mockDonorsError = null;
  mockDispatchesError = null;
  mockMlBehavior = 'SUCCESS';
  mockMlPredictions = new Map();
  mockMlCustomHandler = null;
  process.env.ML_API_URL = 'http://ml.internal:8000';
}

// Setup Supabase mock
supabaseAdmin.from = (table) => {
  if (table === 'donors') {
    const qb = {
      select: () => qb,
      eq: (field, val) => {
        qb._eq = qb._eq || {};
        qb._eq[field] = val;
        return qb;
      },
      limit: (n) => {
        qb._limit = n;
        return qb;
      },
      then: (resolve) => {
        if (mockDonorsError) {
          return resolve({ data: null, error: mockDonorsError });
        }
        let data = [...mockDonors];
        if (qb._eq) {
          for (const [k, v] of Object.entries(qb._eq)) {
            data = data.filter((d) => d[k] === v);
          }
        }
        if (qb._limit) {
          data = data.slice(0, qb._limit);
        }
        return resolve({ data, error: null });
      }
    };
    return qb;
  }

  if (table === 'donor_dispatches') {
    const qb = {
      select: () => qb,
      in: (field, vals) => {
        qb._in = qb._in || {};
        qb._in[field] = vals;
        return qb;
      },
      eq: (field, val) => {
        qb._eq = qb._eq || {};
        qb._eq[field] = val;
        return qb;
      },
      neq: (field, val) => {
        qb._neq = qb._neq || {};
        qb._neq[field] = val;
        return qb;
      },
      then: (resolve) => {
        if (mockDispatchesError) {
          return resolve({ data: null, error: mockDispatchesError });
        }
        let data = [...mockDispatches];
        if (qb._in) {
          for (const [k, vals] of Object.entries(qb._in)) {
            data = data.filter((d) => vals.includes(d[k]));
          }
        }
        if (qb._eq) {
          for (const [k, v] of Object.entries(qb._eq)) {
            data = data.filter((d) => d[k] === v);
          }
        }
        if (qb._neq) {
          for (const [k, v] of Object.entries(qb._neq)) {
            data = data.filter((d) => d[k] !== v);
          }
        }
        return resolve({ data, error: null });
      }
    };
    return qb;
  }

  return originalFrom.call(supabaseAdmin, table);
};

// Setup Mock Fetch for ML API
globalThis.fetch = async (url, options = {}) => {
  if (typeof url === 'string' && url.includes('/predict')) {
    if (mockMlCustomHandler) {
      return mockMlCustomHandler(url, options);
    }
    if (mockMlBehavior === 'NOT_CONFIGURED') {
      const err = new Error('ML_API_URL is not configured');
      err.code = 'ML_NOT_CONFIGURED';
      throw err;
    }
    if (mockMlBehavior === 'TIMEOUT') {
      const err = new Error('ML inference timed out');
      err.name = 'AbortError';
      throw err;
    }
    if (mockMlBehavior === 'INFERENCE_FAILED') {
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      };
    }

    // Default SUCCESS
    const body = JSON.parse(options.body || '{}');
    const custom = mockMlPredictions.get(body.donor_id) || {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        probability: custom.probability ?? 0.85,
        prediction: custom.prediction ?? 1,
        model_version: 'donor_response_v1'
      })
    };
  }

  return originalFetch(url, options);
};

// Helper to create test donor
function createDonor(id, overrides = {}) {
  return {
    id,
    user_id: `user-${id}`,
    name: `Donor ${id}`,
    blood_group: 'O_POSITIVE',
    availability_status: 'AVAILABLE',
    eligibility_status: 'ELIGIBLE',
    last_donation_date: '2026-05-01',
    live_location_enabled: true,
    verified: true,
    current_latitude: 12.9716,
    current_longitude: 77.5946,
    ...overrides
  };
}

const standardRequest = {
  id: 'req-00000000-0000-4000-8000-000000000001',
  blood_group: 'O_POSITIVE',
  resource_type: 'WHOLE_BLOOD',
  quantity: 5,
  urgency: 'HIGH'
};

test.after(() => {
  supabaseAdmin.from = originalFrom;
  globalThis.fetch = originalFetch;
});

// ==========================================
// 1. ML Success Behavior
// ==========================================
test('rankEligibleDonors: ML success preserves ML ranking and metadata', async () => {
  resetMocks();
  mockDonors = [
    createDonor('donor-1'),
    createDonor('donor-2')
  ];

  // Donor 2 has higher probability in ML
  mockMlCustomHandler = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const prob = body.donor_response_rate > 0.5 ? 0.95 : 0.70;
    return {
      ok: true,
      json: async () => ({
        probability: prob,
        prediction: 1,
        model_version: 'donor_response_v1'
      })
    };
  };

  // Give donor-2 history so response_rate is higher
  mockDispatches = [
    { donor_id: 'donor-2', request_id: 'other-req', status: 'COMPLETED' }
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankingSource, 'ML');
  assert.equal(result.modelVersion, 'donor_response_v1');
  assert.equal(result.candidateCount, 2);
  assert.equal(result.rankedDonors[0].donorId, 'donor-2');
  assert.equal(result.rankedDonors[0].responseProbability, 0.95);
  assert.equal(result.rankedDonors[1].donorId, 'donor-1');
  assert.equal(result.rankedDonors[1].responseProbability, 0.70);
  assert.equal(result.nextBatch.length, 2);
});

// ==========================================
// 2. ML_NOT_CONFIGURED Fallback
// ==========================================
test('rankEligibleDonors: ML_NOT_CONFIGURED triggers deterministic fallback', async () => {
  resetMocks();
  delete process.env.ML_API_URL;
  mockDonors = [createDonor('donor-1'), createDonor('donor-2')];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.modelVersion, null);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.nextBatch.length, 2);
});

// ==========================================
// 3. ML_TIMEOUT Fallback
// ==========================================
test('rankEligibleDonors: ML_TIMEOUT triggers deterministic fallback', async () => {
  resetMocks();
  mockMlBehavior = 'TIMEOUT';
  mockDonors = [createDonor('donor-1'), createDonor('donor-2')];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.modelVersion, null);
  assert.equal(result.candidateCount, 2);
});

// ==========================================
// 4. ML_INFERENCE_FAILED Fallback
// ==========================================
test('rankEligibleDonors: ML_INFERENCE_FAILED triggers deterministic fallback', async () => {
  resetMocks();
  mockMlBehavior = 'INFERENCE_FAILED';
  mockDonors = [createDonor('donor-1'), createDonor('donor-2')];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.modelVersion, null);
  assert.equal(result.candidateCount, 2);
});

// ==========================================
// 5. Unrelated Database Errors are NOT Swallowed
// ==========================================
test('rankEligibleDonors: database error in findEligibleDonors throws instead of falling back', async () => {
  resetMocks();
  const dbError = new Error('Database connection failed');
  dbError.code = '42P01';
  mockDonorsError = dbError;

  await assert.rejects(
    () => rankEligibleDonors({ request: standardRequest, batchSize: 5 }),
    (err) => {
      assert.equal(err.code, '42P01');
      assert.equal(err.message, 'Database connection failed');
      return true;
    }
  );
});

test('rankEligibleDonors: database error in getDonorHistory throws instead of falling back', async () => {
  resetMocks();
  mockDonors = [createDonor('donor-1')];
  const historyDbError = new Error('History query timed out');
  historyDbError.code = '57014';
  mockDispatchesError = historyDbError;

  await assert.rejects(
    () => rankEligibleDonors({ request: standardRequest, batchSize: 5 }),
    (err) => {
      assert.equal(err.code, '57014');
      assert.equal(err.message, 'History query timed out');
      return true;
    }
  );
});

// ==========================================
// 6. Deterministic Fallback Ordering Rules
// ==========================================
test('rankEligibleDonors: fallback orders higher historical response rate first', async () => {
  resetMocks();
  mockMlBehavior = 'INFERENCE_FAILED';
  mockDonors = [
    createDonor('donor-low-rate'),
    createDonor('donor-high-rate')
  ];
  // donor-high-rate: 2/2 = 100%
  // donor-low-rate: 1/2 = 50%
  mockDispatches = [
    { donor_id: 'donor-high-rate', request_id: 'r1', status: 'ACCEPTED' },
    { donor_id: 'donor-high-rate', request_id: 'r2', status: 'COMPLETED' },
    { donor_id: 'donor-low-rate', request_id: 'r3', status: 'ACCEPTED' },
    { donor_id: 'donor-low-rate', request_id: 'r4', status: 'DECLINED' }
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK');
  assert.equal(result.rankedDonors[0].donorId, 'donor-high-rate');
  assert.equal(result.rankedDonors[1].donorId, 'donor-low-rate');
});

test('rankEligibleDonors: fallback orders verified donors first when response rate is tied', async () => {
  resetMocks();
  mockMlBehavior = 'NOT_CONFIGURED';
  delete process.env.ML_API_URL;
  // Note: findEligibleDonors filters donors where verified === true in DB query (.eq('verified', true)).
  // If donors come from findEligibleDonors, they are verified. If unverified donors enter ranking (e.g. mock test),
  // verified sorts first:
  mockDonors = [
    createDonor('donor-unverified', { verified: false }),
    createDonor('donor-verified', { verified: true })
  ];

  // Bypass .eq('verified', true) in findEligibleDonors for this unit test by overriding mock
  const origFrom = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    if (table === 'donors') {
      const qb = {
        select: () => qb,
        eq: () => qb, // ignore eq filter
        limit: () => qb,
        then: (resolve) => resolve({ data: mockDonors, error: null })
      };
      return qb;
    }
    return origFrom(table);
  };

  try {
    const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });
    assert.equal(result.rankedDonors[0].donorId, 'donor-verified');
    assert.equal(result.rankedDonors[1].donorId, 'donor-unverified');
  } finally {
    supabaseAdmin.from = origFrom;
  }
});

test('rankEligibleDonors: fallback orders greater positive responses next when rates & verification are tied', async () => {
  resetMocks();
  mockMlBehavior = 'TIMEOUT';
  mockDonors = [
    createDonor('donor-few-responses'),
    createDonor('donor-many-responses')
  ];
  // Both have 100% rate, but donor-many has 4 positive responses vs 1
  mockDispatches = [
    { donor_id: 'donor-many-responses', request_id: 'r1', status: 'COMPLETED' },
    { donor_id: 'donor-many-responses', request_id: 'r2', status: 'COMPLETED' },
    { donor_id: 'donor-many-responses', request_id: 'r3', status: 'ACCEPTED' },
    { donor_id: 'donor-many-responses', request_id: 'r4', status: 'RESPONDED' },
    { donor_id: 'donor-few-responses', request_id: 'r5', status: 'COMPLETED' }
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankedDonors[0].donorId, 'donor-many-responses');
  assert.equal(result.rankedDonors[1].donorId, 'donor-few-responses');
});

test('rankEligibleDonors: fallback orders longer donation history signal next', async () => {
  resetMocks();
  mockMlBehavior = 'INFERENCE_FAILED';
  mockDonors = [
    createDonor('donor-recent', { last_donation_date: '2026-08-01' }),
    createDonor('donor-rested', { last_donation_date: '2025-01-01' })
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankedDonors[0].donorId, 'donor-rested');
  assert.equal(result.rankedDonors[1].donorId, 'donor-recent');
});

test('rankEligibleDonors: fallback uses donor ID ascending as final stable tie-breaker', async () => {
  resetMocks();
  mockMlBehavior = 'INFERENCE_FAILED';
  mockDonors = [
    createDonor('donor-zzz'),
    createDonor('donor-aaa')
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.rankedDonors[0].donorId, 'donor-aaa');
  assert.equal(result.rankedDonors[1].donorId, 'donor-zzz');
});

// ==========================================
// 7. nextBatch Capped at 5
// ==========================================
test('rankEligibleDonors: nextBatch never exceeds 5 even with more candidates', async () => {
  resetMocks();
  mockMlBehavior = 'NOT_CONFIGURED';
  delete process.env.ML_API_URL;
  mockDonors = Array.from({ length: 8 }, (_, i) => createDonor(`donor-${i + 1}`));

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 10 });

  assert.equal(result.candidateCount, 8);
  assert.equal(result.rankedDonors.length, 8);
  assert.equal(result.nextBatch.length, 5);
});

// ==========================================
// 8. Medical Eligibility Remains Upstream and Unchanged
// ==========================================
test('rankEligibleDonors: medical incompatibility and status filtering are preserved upstream', async () => {
  resetMocks();
  mockMlBehavior = 'NOT_CONFIGURED';
  delete process.env.ML_API_URL;

  mockDonors = [
    createDonor('donor-incompatible', { blood_group: 'B_POSITIVE' }), // Recipient needs O_POSITIVE WHOLE_BLOOD
    createDonor('donor-ineligible', { eligibility_status: 'TEMPORARILY_INELIGIBLE' }),
    createDonor('donor-unavailable', { availability_status: 'BUSY' }),
    createDonor('donor-compatible', { blood_group: 'O_POSITIVE' })
  ];

  const result = await rankEligibleDonors({ request: standardRequest, batchSize: 5 });

  assert.equal(result.candidateCount, 1);
  assert.equal(result.rankedDonors[0].donorId, 'donor-compatible');
});
