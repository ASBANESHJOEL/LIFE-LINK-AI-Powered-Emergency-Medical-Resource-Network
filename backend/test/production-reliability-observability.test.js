import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// ============================================================================
// LIFE-LINK PHASE 6: Production Reliability, Observability & Operational Hardening
// Integration Test Suite against Local Docker Supabase
// ============================================================================

const localSupabaseUrl = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const localJwtSecret = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

function generateServiceRoleToken(secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      role: 'service_role',
      iss: 'supabase',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 360000
    })
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const serviceRoleToken = (process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SECRET_KEY !== 'test-secret-key')
  ? process.env.SUPABASE_SECRET_KEY
  : generateServiceRoleToken(localJwtSecret);

// Ensure local Supabase credentials are set before importing app & supabaseAdmin
process.env.SUPABASE_URL = localSupabaseUrl;
process.env.SUPABASE_SECRET_KEY = serviceRoleToken;

const { default: app } = await import('../src/app.js');
const { supabaseAdmin } = await import('../src/lib/supabaseAdmin.js');
const { rankEligibleDonors } = await import('../src/services/donorRankingService.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

let server;
let baseUrl;

function generateJwt(userId, email, role = 'authenticated') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email,
      role,
      aud: 'authenticated',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 360000
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', localJwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// Seeded local role users in local Docker Supabase
const HOSPITAL_A_USER_ID = '3beb87e8-cf22-4b83-bf5e-178df6e7b755';
const HOSPITAL_A_EMAIL = 'hospital-a@lifelink.local';
const HOSPITAL_A_ID = '10000000-0000-0000-0000-000000000001';

const DONOR_A_USER_ID = '4579c41a-0ae8-469c-8b9a-87d9c248faae';
const DONOR_A_EMAIL = 'donor-a@lifelink.local';

const hospitalAToken = generateJwt(HOSPITAL_A_USER_ID, HOSPITAL_A_EMAIL);
const donorAToken = generateJwt(DONOR_A_USER_ID, DONOR_A_EMAIL);

const cleanupArtifacts = { requestIds: [] };

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => {
    server.once('listening', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (cleanupArtifacts.requestIds.length > 0) {
    await supabaseAdmin
      .from('emergency_requests')
      .delete()
      .in('id', cleanupArtifacts.requestIds);
  }
  if (server) {
    server.close();
  }
});

// ============================================================================
// A & B: API RELIABILITY & CENTRALIZED ERROR HANDLING
// ============================================================================

test('A. Malformed JSON request body returns structured 400 Bad Request error', async () => {
  const res = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAToken}`
    },
    body: '{ malformed json payload'
  });

  assert.equal(res.status, 400);
  assert.ok(res.headers.get('x-request-id'), 'X-Request-Id header must be present on error');

  const json = await res.json();
  assert.ok(json.error, 'Response must have structured error');
  assert.equal(json.error.code, 'BAD_REQUEST');
  assert.ok(json.error.message.includes('Malformed JSON'));
  // Ensure no internal stack traces or filesystem paths are exposed
  assert.equal(JSON.stringify(json).includes('node_modules'), false);
  assert.equal(JSON.stringify(json).includes('SyntaxError:'), false);
});

test('B. Centralized error handling on 404 unknown routes returns structured error without stack leak', async () => {
  const res = await fetch(`${baseUrl}/api/nonexistent-route-${Date.now()}`);
  assert.equal(res.status, 404);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.ok(json.error);
  assert.equal(json.error.code, 'NOT_FOUND');
  assert.ok(json.error.message);
  assert.equal(JSON.stringify(json).includes('stack'), false);
});

test('B2. 404 handler does NOT echo query-string secrets in response', async () => {
  const res = await fetch(`${baseUrl}/api/nonexistent-endpoint?token=secret&otp=1234`);
  assert.equal(res.status, 404);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.ok(json.error);
  assert.equal(json.error.code, 'NOT_FOUND');
  assert.equal(json.error.message, 'Cannot GET /api/nonexistent-endpoint');

  const rawJson = JSON.stringify(json);
  assert.equal(rawJson.includes('secret'), false, 'Response must not contain query token');
  assert.equal(rawJson.includes('1234'), false, 'Response must not contain query OTP');
});

// ============================================================================
// C & D: AUTHENTICATION & ROLE AUTHORIZATION PRESERVATION
// ============================================================================

test('C. Unauthorized request to protected endpoint returns 401 without crashing', async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(res.status, 401);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.ok(json.error);
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('D. Forbidden request (Donor attempting Hospital-only endpoint) returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/hospital/ping`, {
    headers: {
      Authorization: `Bearer ${donorAToken}`
    }
  });

  assert.equal(res.status, 403);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
});

// ============================================================================
// E, F & PRIVACY: REQUEST CORRELATION / X-REQUEST-ID & LOG PRIVACY
// ============================================================================

test('E. Custom incoming X-Request-Id is safely preserved and reflected in response', async () => {
  const customId = 'req-trace-test-123456';
  const res = await fetch(`${baseUrl}/api/health`, {
    headers: {
      'X-Request-Id': customId
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id'), customId);
});

test('F. Requests without X-Request-Id automatically receive generated correlation UUID', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);

  const returnedId = res.headers.get('x-request-id');
  assert.ok(returnedId, 'X-Request-Id must be generated');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(uuidRegex.test(returnedId), 'Generated X-Request-Id should be a valid UUID');
});

test('F2. Unsafe/malicious X-Request-Id characters are safely replaced with generated UUID', async () => {
  const unsafeHeader = 'unsafe;id<script>alert(1)</script>';
  const res = await fetch(`${baseUrl}/api/health`, {
    headers: {
      'X-Request-Id': unsafeHeader
    }
  });

  assert.equal(res.status, 200);
  const returnedId = res.headers.get('x-request-id');
  assert.ok(returnedId);
  assert.notEqual(returnedId, unsafeHeader);
  assert.equal(returnedId.includes('<script>'), false);
});

test('F3. Request correlation log privacy: query parameters and sensitive tokens are strictly excluded from logs', async () => {
  const originalLog = console.log;
  const capturedLogs = [];
  process.env.ENABLE_TEST_REQUEST_LOGS = 'true';

  try {
    console.log = (msg) => {
      capturedLogs.push(msg);
    };

    // Send request with sensitive query parameters
    await fetch(`${baseUrl}/api/health?token=secret123&patient=john_doe&otp=9999&diagnosis=urgent`);

    // Give finish event tick to execute
    await new Promise((r) => setTimeout(r, 50));

    // Find the emitted request log
    const requestLogStr = capturedLogs.find((l) => typeof l === 'string' && l.includes('"requestId"'));
    assert.ok(requestLogStr, 'Emitted structured JSON request log must exist');

    const parsed = JSON.parse(requestLogStr);
    assert.equal(parsed.route, '/api/health', 'Log route must exclude query string parameters');
    assert.ok(parsed.timestamp);
    assert.ok(parsed.requestId);
    assert.equal(parsed.method, 'GET');
    assert.equal(parsed.statusCode, 200);
    assert.ok(typeof parsed.durationMs === 'number');

    // Sensitive leakage assertions: query strings, secrets, patient data must NEVER appear
    assert.equal(requestLogStr.includes('secret123'), false, 'Query secret must not be logged');
    assert.equal(requestLogStr.includes('john_doe'), false, 'Patient name must not be logged');
    assert.equal(requestLogStr.includes('9999'), false, 'OTP must not be logged');
    assert.equal(requestLogStr.includes('diagnosis'), false, 'Diagnosis must not be logged');
  } finally {
    console.log = originalLog;
    delete process.env.ENABLE_TEST_REQUEST_LOGS;
  }
});

// ============================================================================
// G & H: HEALTH & READINESS ENDPOINTS
// ============================================================================

test('G. Liveness endpoint returns 200 OK without accessing database', async () => {
  const res = await fetch(`${baseUrl}/api/health/liveness`);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.equal(json.status, 'ok');
  assert.ok(typeof json.uptimeSeconds === 'number');
  assert.ok(json.timestamp);
});

test('H. Readiness endpoint checks database and handles degraded ML dependency', async () => {
  const res = await fetch(`${baseUrl}/api/health/readiness`);
  // Database is running in local Docker, so overall readiness is 200 OK
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));

  const json = await res.json();
  assert.ok(json.status === 'ok' || json.status === 'degraded');
  assert.ok(json.dependencies);
  assert.equal(json.dependencies.database, 'ok');
  // ML service is optional: ok or degraded if ML service is not running locally
  assert.ok(['ok', 'degraded'].includes(json.dependencies.ml));
});

// ============================================================================
// I: ML FAILURE RESILIENCE & RESPONSE VALIDATION
// ============================================================================

test('I. ML service failure or malformed payload falls back to deterministic ranking safely', async () => {
  const testReq = {
    id: crypto.randomUUID(),
    blood_group: 'O_POSITIVE',
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    quantity: 2
  };

  // 1. With unconfigured or unreachable ML API URL
  const originalMlUrl = process.env.ML_API_URL;
  try {
    process.env.ML_API_URL = 'http://127.0.0.1:59999'; // unreachable port

    const result = await rankEligibleDonors({ request: testReq, limit: 10 });
    assert.ok(result);
    // When ML fails or is unreachable, rankingSource must be DETERMINISTIC_FALLBACK
    assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK');
    assert.ok(Array.isArray(result.rankedDonors));
    assert.ok(Array.isArray(result.nextBatch));
  } finally {
    process.env.ML_API_URL = originalMlUrl;
  }
});

test('I2. ML response validation: missing probability triggers deterministic fallback', async () => {
  const testReq = {
    id: crypto.randomUUID(),
    blood_group: 'O_POSITIVE',
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    quantity: 2
  };

  const originalFetch = globalThis.fetch;
  try {
    process.env.ML_API_URL = 'http://ml.internal:8000';
    // Mock ML response missing 'probability'
    globalThis.fetch = async (url, options) => {
      const urlStr = typeof url === 'string' ? url : url?.url || '';
      if (urlStr.includes('/predict')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ prediction: 1, model_version: 'v1' }) // Missing probability
        };
      }
      return originalFetch(url, options);
    };

    const result = await rankEligibleDonors({ request: testReq, limit: 10 });
    assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK', 'Must fall back on missing probability');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('I3. ML response validation: probability = Infinity triggers deterministic fallback', async () => {
  const testReq = {
    id: crypto.randomUUID(),
    blood_group: 'O_POSITIVE',
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    quantity: 2
  };

  const originalFetch = globalThis.fetch;
  try {
    process.env.ML_API_URL = 'http://ml.internal:8000';
    // Mock ML response with non-finite probability
    globalThis.fetch = async (url, options) => {
      const urlStr = typeof url === 'string' ? url : url?.url || '';
      if (urlStr.includes('/predict')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ probability: Infinity, prediction: 1, model_version: 'v1' })
        };
      }
      return originalFetch(url, options);
    };

    const result = await rankEligibleDonors({ request: testReq, limit: 10 });
    assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK', 'Must fall back on probability = Infinity');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('I4. ML response validation: missing prediction triggers deterministic fallback', async () => {
  const testReq = {
    id: crypto.randomUUID(),
    blood_group: 'O_POSITIVE',
    resource_type: 'RED_BLOOD_CELLS',
    urgency: 'CRITICAL',
    quantity: 2
  };

  const originalFetch = globalThis.fetch;
  try {
    process.env.ML_API_URL = 'http://ml.internal:8000';
    // Mock ML response missing 'prediction'
    globalThis.fetch = async (url, options) => {
      const urlStr = typeof url === 'string' ? url : url?.url || '';
      if (urlStr.includes('/predict')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ probability: 0.75, model_version: 'v1' }) // Missing prediction
        };
      }
      return originalFetch(url, options);
    };

    const result = await rankEligibleDonors({ request: testReq, limit: 10 });
    assert.equal(result.rankingSource, 'DETERMINISTIC_FALLBACK', 'Must fall back on missing prediction');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// J & N: DATABASE ERROR HANDLING & PRIVACY
// ============================================================================

test('J. Database / validation errors produce safe structured error without leaking SQL internals', async () => {
  // Attempt invalid emergency request creation with missing fields
  const res = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAToken}`
    },
    body: JSON.stringify({
      blood_group: 'INVALID_GROUP',
      quantity: -5
    })
  });

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.error);
  // Ensure SQL table or internal column definitions are never leaked in API response
  const responseStr = JSON.stringify(json);
  assert.equal(responseStr.includes('pg_catalog'), false);
  assert.equal(responseStr.includes('public.emergency_requests'), false);
});

test('J2. Non-5xx errors containing sensitive SQL or filesystem paths are sanitized while preserving domain codes and status', () => {
  const req = { id: 'test-req-security-123' };
  let responseStatus;
  let responseBody;
  const res = {
    status(code) {
      responseStatus = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  // 1. 400 Bad Request error containing sensitive SQL statement
  const sqlError = new Error('syntax error at or near "SELECT * FROM public.emergency_requests" at /Users/developer/backend/src/db.js:10');
  sqlError.status = 400;
  sqlError.code = 'INVALID_REQUEST';

  errorHandler(sqlError, req, res, () => {});

  assert.equal(responseStatus, 400, 'HTTP status 400 must NOT be turned into 500');
  assert.equal(responseBody.error.code, 'INVALID_REQUEST', 'Domain error code must be preserved');
  assert.equal(responseBody.error.message, 'Invalid request payload or operation.', 'Message must be sanitized');
  const rawSqlResponse = JSON.stringify(responseBody);
  assert.equal(rawSqlResponse.includes('SELECT'), false, 'SQL statement must not leak');
  assert.equal(rawSqlResponse.includes('public.emergency_requests'), false, 'Database schema must not leak');
  assert.equal(rawSqlResponse.includes('/Users/developer'), false, 'Filesystem path must not leak');

  // 2. 409 Conflict error with valid domain message -> must remain usable & unchanged
  const domainError1 = new Error('Emergency request is already fulfilled');
  domainError1.status = 409;
  domainError1.code = 'REQUEST_ALREADY_FULFILLED';

  errorHandler(domainError1, req, res, () => {});

  assert.equal(responseStatus, 409);
  assert.equal(responseBody.error.code, 'REQUEST_ALREADY_FULFILLED');
  assert.equal(responseBody.error.message, 'Emergency request is already fulfilled');

  // 3. 400 Bad Request error with valid domain message -> must remain usable & unchanged
  const domainError2 = new Error('Invalid emergency request state');
  domainError2.status = 400;
  domainError2.code = 'INVALID_STATE';

  errorHandler(domainError2, req, res, () => {});

  assert.equal(responseStatus, 400);
  assert.equal(responseBody.error.code, 'INVALID_STATE');
  assert.equal(responseBody.error.message, 'Invalid emergency request state');

  // 4. 403 Forbidden with valid domain message -> preserved
  const domainError3 = new Error('Forbidden');
  domainError3.status = 403;

  errorHandler(domainError3, req, res, () => {});

  assert.equal(responseStatus, 403);
  assert.equal(responseBody.error.code, 'FORBIDDEN');
  assert.equal(responseBody.error.message, 'Forbidden');
});

// ============================================================================
// K, L, M & N: AUDIT LOG INTEGRITY & OBSERVABILITY
// ============================================================================

test('K & L. Emergency Request creation and cancellation record structured audit logs without sensitive data', async () => {
  // 1. Create a real emergency request
  const createRes = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hospitalAToken}`
    },
    body: JSON.stringify({
      blood_group: 'B_POSITIVE',
      quantity: 2,
      resource_type: 'WHOLE_BLOOD',
      urgency: 'HIGH'
    })
  });

  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  const requestId = createData.request?.id;
  assert.ok(requestId);
  cleanupArtifacts.requestIds.push(requestId);

  // Verify EMERGENCY_REQUEST_CREATED audit log exists
  const { data: createLogs, error: logErr1 } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('entity_id', requestId)
    .eq('action', 'EMERGENCY_REQUEST_CREATED');

  assert.equal(logErr1, null);
  assert.ok(createLogs && createLogs.length >= 1, 'EMERGENCY_REQUEST_CREATED audit log must exist');

  const createLog = createLogs[0];
  assert.equal(createLog.actor_user_id, HOSPITAL_A_USER_ID);
  assert.equal(createLog.metadata?.blood_group, 'B_POSITIVE');
  assert.equal(createLog.metadata?.quantity, 2);

  // PRIVACY CHECK: ensure no sensitive patient fields or GPS in metadata
  const metaStr = JSON.stringify(createLog.metadata);
  assert.equal(metaStr.includes('patient'), false);
  assert.equal(metaStr.includes('diagnosis'), false);
  assert.equal(metaStr.includes('latitude'), false);
  assert.equal(metaStr.includes('longitude'), false);

  // 2. Cancel the emergency request
  const cancelRes = await fetch(`${baseUrl}/api/requests/${requestId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hospitalAToken}`
    }
  });

  assert.equal(cancelRes.status, 200);

  // Verify EMERGENCY_REQUEST_CANCELLED audit log exists
  const { data: cancelLogs, error: logErr2 } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('entity_id', requestId)
    .eq('action', 'EMERGENCY_REQUEST_CANCELLED');

  assert.equal(logErr2, null);
  assert.ok(cancelLogs && cancelLogs.length >= 1, 'EMERGENCY_REQUEST_CANCELLED audit log must exist');

  // 3. Repeated cancellation is idempotent and does not create duplicate audit records
  const cancelRes2 = await fetch(`${baseUrl}/api/requests/${requestId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hospitalAToken}`
    }
  });

  // Returns 200 idempotent or 409 INVALID_REQUEST_STATE
  assert.ok([200, 409].includes(cancelRes2.status));

  const { data: cancelLogsAfter } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('entity_id', requestId)
    .eq('action', 'EMERGENCY_REQUEST_CANCELLED');

  assert.equal(cancelLogsAfter.length, cancelLogs.length, 'Idempotent cancellation must not duplicate audit log');
});

test('M. Emergency Request expiry records structured audit log', async () => {
  // Insert test emergency request
  const { data: req, error: insertErr } = await supabaseAdmin
    .from('emergency_requests')
    .insert({
      hospital_id: HOSPITAL_A_ID,
      blood_group: 'AB_POSITIVE',
      quantity: 1,
      resource_type: 'WHOLE_BLOOD',
      urgency: 'MEDIUM',
      status: 'OPEN',
      is_synthetic: true
    })
    .select('id')
    .single();

  assert.equal(insertErr, null);
  assert.ok(req?.id);
  cleanupArtifacts.requestIds.push(req.id);

  // Call expire RPC
  const { error: expireErr } = await supabaseAdmin.rpc('expire_emergency_request', {
    p_request_id: req.id,
    p_actor_user_id: HOSPITAL_A_USER_ID
  });

  assert.equal(expireErr, null);

  // Check audit log
  const { data: logs } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .eq('entity_id', req.id)
    .eq('action', 'EMERGENCY_REQUEST_EXPIRED');

  assert.ok(logs && logs.length >= 1, 'EMERGENCY_REQUEST_EXPIRED audit log must be recorded');
  const log = logs[0];
  assert.equal(log.actor_user_id, HOSPITAL_A_USER_ID);
  const logStr = JSON.stringify(log.metadata);
  assert.equal(logStr.includes('patient'), false);
  assert.equal(logStr.includes('coordinates'), false);
});

// ============================================================================
// O: PRODUCTION CORS BEHAVIOR
// ============================================================================

test('O. Production CORS strictly rejects disallowed external origins including unrelated Vercel deployments', async () => {
  const origEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    // 1. Completely unrelated domain -> REJECTED
    const res1 = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil-unauthorized-site.com' }
    });
    assert.equal(res1.status, 403);
    const json1 = await res1.json();
    assert.equal(json1.error?.code, 'CORS_FORBIDDEN');

    // 2. Unrelated/random Vercel project -> MUST BE REJECTED (no blanket *.vercel.app allowance)
    const res2 = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://random-unrelated-project.vercel.app' }
    });
    assert.equal(res2.status, 403);
    const json2 = await res2.json();
    assert.equal(json2.error?.code, 'CORS_FORBIDDEN');

    // 3. Explicitly configured LIFE-LINK Vercel domain -> ALLOWED
    const res3 = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://life-link-ai-powered-emergency-medi.vercel.app' }
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.headers.get('access-control-allow-origin'), 'https://life-link-ai-powered-emergency-medi.vercel.app');

    // 4. Primary production domain -> ALLOWED
    const res4 = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://life-link.in' }
    });
    assert.equal(res4.status, 200);
    assert.equal(res4.headers.get('access-control-allow-origin'), 'https://life-link.in');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});
