import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOsrmRouteUrl,
  requestOsrmRoute,
  getDonorDispatchRoute
} from '../src/services/osrmService.js';
import { supabaseAdmin } from '../src/lib/supabaseAdmin.js';

const ORIGINAL_FETCH = global.fetch;

const TEST_DISPATCH_ID = '11111111-2222-4000-8000-333333333333';
const TEST_REQUEST_ID = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
const TEST_DONOR_ID = 'dddddddd-eeee-4000-8000-ffffffffffff';
const TEST_DONOR_USER_ID = '99999999-8888-4000-8000-777777777777';

function mockSupabaseForRouting() {
  const originalFrom = supabaseAdmin.from;
  supabaseAdmin.from = (table) => {
    const qb = {
      select: () => qb,
      eq: () => qb,
      order: () => qb,
      limit: () => qb,
      maybeSingle: async () => {
        if (table === 'donor_dispatches') {
          return {
            data: {
              id: TEST_DISPATCH_ID,
              request_id: TEST_REQUEST_ID,
              donor_id: TEST_DONOR_ID,
              status: 'ACCEPTED'
            },
            error: null
          };
        }
        if (table === 'emergency_requests') {
          return {
            data: {
              id: TEST_REQUEST_ID,
              hospital_id: 'hosp-1',
              hospital_latitude: 13.0827,
              hospital_longitude: 80.2707
            },
            error: null
          };
        }
        if (table === 'donors') {
          return {
            data: {
              id: TEST_DONOR_ID,
              user_id: TEST_DONOR_USER_ID,
              current_latitude: 12.9716,
              current_longitude: 77.5946
            },
            error: null
          };
        }
        if (table === 'live_locations') {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }
    };
    return qb;
  };
  return () => {
    supabaseAdmin.from = originalFrom;
  };
}

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.OSRM_BASE_URL;
  delete process.env.OSRM_PROFILE;
  delete process.env.OSRM_TIMEOUT_MS;
});

test('buildOsrmRouteUrl encodes OSRM coordinates in longitude,latitude order', () => {
  const url = buildOsrmRouteUrl(
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 13.0827, longitude: 80.2707 }
  );

  assert.equal(
    url,
    'https://router.project-osrm.org/route/v1/driving/77.5946,12.9716;80.2707,13.0827?overview=full&geometries=geojson&steps=false'
  );
});

test('buildOsrmRouteUrl rejects invalid coordinates', () => {
  assert.throws(
    () => buildOsrmRouteUrl(
      { latitude: 95, longitude: 77.5946 },
      { latitude: 13.0827, longitude: 80.2707 }
    ),
    (error) => error.code === 'INVALID_COORDINATES'
  );
});

test('requestOsrmRoute maps OSRM distance, duration, geometry, and ETA', async () => {
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        code: 'Ok',
        data_version: '2026-09-18T00:00:00Z',
        routes: [{
          distance: 12543.4,
          duration: 812.2,
          geometry: {
            type: 'LineString',
            coordinates: [[77.59, 12.97], [80.27, 13.08]]
          }
        }]
      };
    }
  });

  const result = await requestOsrmRoute(
    { latitude: 12.9716, longitude: 77.5946 },
    { latitude: 13.0827, longitude: 80.2707 }
  );

  assert.equal(result.distanceMeters, 12543.4);
  assert.equal(result.durationSeconds, 812.2);
  assert.equal(result.etaMinutes, 14);
  assert.equal(result.dataVersion, '2026-09-18T00:00:00Z');
  assert.equal(result.geometry.type, 'LineString');
});

test('requestOsrmRoute maps NoRoute to a safe domain error', async () => {
  global.fetch = async () => ({
    ok: true,
    async json() {
      return { code: 'NoRoute', message: 'No route found' };
    }
  });

  await assert.rejects(
    () => requestOsrmRoute(
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 13.0827, longitude: 80.2707 }
    ),
    (error) => error.code === 'NO_ROUTE'
  );
});

test('requestOsrmRoute times out without leaking the upstream error', async () => {
  global.fetch = async (_url, options) => {
    await new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  process.env.OSRM_TIMEOUT_MS = '1000';

  await assert.rejects(
    () => requestOsrmRoute(
      { latitude: 12.9716, longitude: 77.5946 },
      { latitude: 13.0827, longitude: 80.2707 }
    ),
    (error) => error.code === 'OSRM_TIMEOUT'
  );
});

test('getDonorDispatchRoute: successful OSRM response reports routingProvider = "OSRM" and fallback = false', async () => {
  const restoreDb = mockSupabaseForRouting();
  try {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          code: 'Ok',
          data_version: '2026-09-18T00:00:00Z',
          routes: [{
            distance: 5000,
            duration: 300,
            geometry: {
              type: 'LineString',
              coordinates: [[77.59, 12.97], [80.27, 13.08]]
            }
          }]
        };
      }
    });

    const route = await getDonorDispatchRoute({
      dispatchId: TEST_DISPATCH_ID,
      user: { id: TEST_DONOR_USER_ID, role: 'DONOR' }
    });

    assert.equal(route.routingProvider, 'OSRM');
    assert.equal(route.fallback, false);
    assert.equal(route.distanceKm, 5);
    assert.equal(route.etaMinutes, 5);
  } finally {
    restoreDb();
  }
});

test('getDonorDispatchRoute: development fallback reports routingProvider = "OSRM_DEV_FALLBACK" and fallback = true', async () => {
  const restoreDb = mockSupabaseForRouting();
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'development';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    // Simulate OSRM service failure
    global.fetch = async () => {
      throw new Error('OSRM upstream service unreachable');
    };

    const route = await getDonorDispatchRoute({
      dispatchId: TEST_DISPATCH_ID,
      user: { id: TEST_DONOR_USER_ID, role: 'DONOR' }
    });

    assert.equal(route.routingProvider, 'OSRM_DEV_FALLBACK');
    assert.equal(route.fallback, true);
    assert.ok(route.distanceKm > 0);
    assert.ok(route.etaMinutes >= 1);
    assert.equal(route.geometry.type, 'LineString');
    assert.equal(route.dataVersion, 'DEV_FALLBACK');
  } finally {
    restoreDb();
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('getDonorDispatchRoute: production OSRM failure still returns the existing routing-service error', async () => {
  const restoreDb = mockSupabaseForRouting();
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'production';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'false';

    global.fetch = async () => ({
      ok: false,
      async json() {
        return { code: 'InternalError', message: 'OSRM 500 error' };
      }
    });

    await assert.rejects(
      () => getDonorDispatchRoute({
        dispatchId: TEST_DISPATCH_ID,
        user: { id: TEST_DONOR_USER_ID, role: 'DONOR' }
      }),
      (error) => error.code === 'OSRM_UNAVAILABLE'
    );
  } finally {
    restoreDb();
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('getDonorDispatchRoute: production OSRM NoRoute still throws NO_ROUTE error without fallback', async () => {
  const restoreDb = mockSupabaseForRouting();
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'production';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'false';

    global.fetch = async () => ({
      ok: true,
      async json() {
        return { code: 'NoRoute', message: 'No route found' };
      }
    });

    await assert.rejects(
      () => getDonorDispatchRoute({
        dispatchId: TEST_DISPATCH_ID,
        user: { id: TEST_DONOR_USER_ID, role: 'DONOR' }
      }),
      (error) => error.code === 'NO_ROUTE'
    );
  } finally {
    restoreDb();
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});
