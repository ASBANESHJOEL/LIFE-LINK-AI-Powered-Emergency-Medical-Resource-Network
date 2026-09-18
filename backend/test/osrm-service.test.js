import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOsrmRouteUrl, requestOsrmRoute } from '../src/services/osrmService.js';

const ORIGINAL_FETCH = global.fetch;

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
