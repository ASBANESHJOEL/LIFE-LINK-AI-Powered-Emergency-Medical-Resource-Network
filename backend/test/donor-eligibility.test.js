import './setup.js';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { supabaseAdmin } from '../src/lib/supabaseAdmin.js';
import { isCompatibleDonor } from '../src/services/donorEligibilityService.js';

// ==========================================
// 1. UNIT TESTS: Blood Compatibility Logic
// ==========================================
const compatibilityCases = [
  ['O_NEGATIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', true],
  ['A_NEGATIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', true],
  ['B_POSITIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', false],
  ['AB_POSITIVE', 'A_POSITIVE', 'PLASMA', true],
  ['O_POSITIVE', 'A_POSITIVE', 'PLASMA', false],
  ['A_POSITIVE', 'A_POSITIVE', 'WHOLE_BLOOD', true],
  ['O_POSITIVE', 'A_POSITIVE', 'WHOLE_BLOOD', false],
  ['A_POSITIVE', 'A_POSITIVE', 'PLATELETS', true],
  ['B_POSITIVE', 'A_POSITIVE', 'PLATELETS', false],
  ['A_POSITIVE', 'A_POSITIVE', 'UNSUPPORTED', false]
];

for (const [donorBloodGroup, recipientBloodGroup, componentType, expected] of compatibilityCases) {
  test(`compatibility: ${donorBloodGroup} donor -> ${recipientBloodGroup} recipient (${componentType})`, () => {
    assert.equal(
      isCompatibleDonor({ donorBloodGroup, recipientBloodGroup, componentType }),
      expected
    );
  });
}

// ==========================================
// 2. HTTP ENDPOINT REGRESSION TESTS:
//    GET /api/requests/:requestId/eligible-donors
// ==========================================

const VALID_HOSPITAL_ID = '11111111-1111-4000-8000-111111111111';
const OTHER_HOSPITAL_ID = '22222222-2222-4000-8000-222222222222';
const VALID_REQUEST_ID = '33333333-3333-4000-8000-333333333333';
const VALID_ACTOR_USER_ID = '44444444-4444-4000-8000-444444444444';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

const originalGetUser = supabaseAdmin.auth.getUser;
const originalFrom = supabaseAdmin.from;

after(() => {
  server.close();
  supabaseAdmin.auth.getUser = originalGetUser;
  supabaseAdmin.from = originalFrom;
});

async function apiGet(path, token = null) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

let mockEmergencyRequest = null;
let mockDonors = [];
let mockDispatches = [];
let mockDbError = null;

function resetMocks() {
  mockEmergencyRequest = {
    id: VALID_REQUEST_ID,
    hospital_id: VALID_HOSPITAL_ID,
    blood_group: 'A_POSITIVE',
    quantity: 2,
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    status: 'OPEN'
  };
  mockDonors = [
    {
      id: 'donor-1',
      user_id: 'donor-user-1',
      name: 'Jane Doe',
      blood_group: 'O_NEGATIVE',
      availability_status: 'AVAILABLE',
      eligibility_status: 'ELIGIBLE',
      last_donation_date: '2025-01-01',
      live_location_enabled: true,
      verified: true,
      current_latitude: 12.9716,
      current_longitude: 77.5946
    }
  ];
  mockDispatches = [];
  mockDbError = null;
}

beforeEach(() => {
  resetMocks();

  // Mock Supabase Auth
  supabaseAdmin.auth.getUser = async (token) => {
    if (token === 'hospital-token') {
      return { data: { user: { id: VALID_ACTOR_USER_ID, email: 'hospital@lifelink.test' } }, error: null };
    }
    if (token === 'donor-token') {
      return { data: { user: { id: 'donor-user-id', email: 'donor@lifelink.test' } }, error: null };
    }
    if (token === 'unprovisioned-hospital-token') {
      return { data: { user: { id: 'unprov-user-id', email: 'unprov@lifelink.test' } }, error: null };
    }
    return { data: { user: null }, error: new Error('Invalid token') };
  };

  // Mock Supabase DB query builder
  supabaseAdmin.from = (table) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: (field, val) => ({
            maybeSingle: async () => {
              if (val === VALID_ACTOR_USER_ID) {
                return {
                  data: {
                    id: VALID_ACTOR_USER_ID,
                    email: 'hospital@lifelink.test',
                    role: 'HOSPITAL',
                    is_active: true
                  },
                  error: null
                };
              }
              if (val === 'donor-user-id') {
                return {
                  data: {
                    id: 'donor-user-id',
                    email: 'donor@lifelink.test',
                    role: 'DONOR',
                    is_active: true
                  },
                  error: null
                };
              }
              if (val === 'unprov-user-id') {
                return {
                  data: {
                    id: 'unprov-user-id',
                    email: 'unprov@lifelink.test',
                    role: 'HOSPITAL',
                    is_active: true
                  },
                  error: null
                };
              }
              return { data: null, error: null };
            }
          })
        })
      };
    }

    if (table === 'organization_members') {
      return {
        select: () => ({
          eq: (field1, val1) => ({
            eq: (field2, val2) => ({
              maybeSingle: async () => {
                if (val1 === VALID_ACTOR_USER_ID) {
                  return {
                    data: {
                      id: 'membership-1',
                      organization_type: 'HOSPITAL',
                      hospital_id: VALID_HOSPITAL_ID,
                      membership_role: 'ADMIN',
                      is_active: true,
                      hospitals: { id: VALID_HOSPITAL_ID, hospital_name: 'City Hospital' }
                    },
                    error: null
                  };
                }
                return { data: null, error: null };
              }
            })
          })
        })
      };
    }

    if (table === 'emergency_requests') {
      return {
        select: () => ({
          eq: (field, val) => ({
            maybeSingle: async () => {
              if (mockDbError) return { data: null, error: mockDbError };
              if (mockEmergencyRequest && mockEmergencyRequest.id === val) {
                return { data: mockEmergencyRequest, error: null };
              }
              return { data: null, error: null };
            }
          })
        })
      };
    }

    if (table === 'donors') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: mockDonors, error: null })
              })
            })
          })
        })
      };
    }

    if (table === 'donor_dispatches') {
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: mockDispatches, error: null })
          })
        })
      };
    }

    return originalFrom.call(supabaseAdmin, table);
  };
});

test('GET /api/requests/:requestId/eligible-donors: rejects unauthenticated requests with 401', async () => {
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`);
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('GET /api/requests/:requestId/eligible-donors: rejects non-HOSPITAL role (DONOR) with 403', async () => {
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'donor-token');
  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('GET /api/requests/:requestId/eligible-donors: rejects unprovisioned hospital user with 403', async () => {
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'unprovisioned-hospital-token');
  assert.equal(status, 403);
  assert.equal(body.error, 'HOSPITAL_NOT_PROVISIONED');
});

test('GET /api/requests/:requestId/eligible-donors: rejects malformed requestId with 400', async () => {
  const { status, body } = await apiGet('/api/requests/not-a-uuid/eligible-donors', 'hospital-token');
  assert.equal(status, 400);
  assert.equal(body.error, 'INVALID_REQUEST_ID');
});

test('GET /api/requests/:requestId/eligible-donors: returns 404 when request is not found', async () => {
  mockEmergencyRequest = null;
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'hospital-token');
  assert.equal(status, 404);
  assert.equal(body.error, 'REQUEST_NOT_FOUND');
});

test('GET /api/requests/:requestId/eligible-donors: returns 403 when request belongs to another hospital', async () => {
  mockEmergencyRequest.hospital_id = OTHER_HOSPITAL_ID;
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'hospital-token');
  assert.equal(status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('GET /api/requests/:requestId/eligible-donors: returns 409 when request is not open', async () => {
  mockEmergencyRequest.status = 'FULFILLED';
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'hospital-token');
  assert.equal(status, 409);
  assert.equal(body.error, 'REQUEST_NOT_OPEN');
});

test('GET /api/requests/:requestId/eligible-donors: returns 422 when resource type is unsupported', async () => {
  mockEmergencyRequest.resource_type = 'MEDICATION';
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'hospital-token');
  assert.equal(status, 422);
  assert.equal(body.error, 'UNSUPPORTED_RESOURCE_TYPE');
});

test('GET /api/requests/:requestId/eligible-donors: allows authenticated HOSPITAL user to retrieve eligible donors', async () => {
  const { status, body } = await apiGet(`/api/requests/${VALID_REQUEST_ID}/eligible-donors`, 'hospital-token');
  assert.equal(status, 200);
  assert.equal(body.requestId, VALID_REQUEST_ID);
  assert.equal(body.requestedUnits, 2);
  assert.equal(body.urgency, 'CRITICAL');
  assert.equal(body.candidateCount, 1);
  assert.equal(Array.isArray(body.donors), true);
  assert.equal(body.donors.length, 1);
  assert.equal(body.donors[0].donorId, 'donor-1');
  assert.equal(body.donors[0].bloodGroup, 'O_NEGATIVE');
  assert.equal(body.ranking.status, 'NOT_RANKED');
});
