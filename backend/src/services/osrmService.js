import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const DEFAULT_BASE_URL = 'https://router.project-osrm.org';
const DEFAULT_PROFILE = 'driving';
const DEFAULT_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getOsrmBaseUrl() {
  const value = String(process.env.OSRM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw Object.assign(new Error('OSRM_BASE_URL must use HTTP(S)'), { code: 'OSRM_CONFIG_ERROR' });
  }
  return url.toString().replace(/\/$/, '');
}

function validateCoordinate(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function buildOsrmRouteUrl(origin, destination) {
  if (!validateCoordinate(origin.latitude, -90, 90) ||
      !validateCoordinate(origin.longitude, -180, 180) ||
      !validateCoordinate(destination.latitude, -90, 90) ||
      !validateCoordinate(destination.longitude, -180, 180)) {
    const error = new Error('Invalid routing coordinates');
    error.code = 'INVALID_COORDINATES';
    throw error;
  }

  const profile = String(process.env.OSRM_PROFILE || DEFAULT_PROFILE).trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(profile)) {
    const error = new Error('Invalid OSRM profile');
    error.code = 'OSRM_CONFIG_ERROR';
    throw error;
  }

  const base = getOsrmBaseUrl();
  const coordinates = [
    `${origin.longitude},${origin.latitude}`,
    `${destination.longitude},${destination.latitude}`
  ].join(';');

  return `${base}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false`;
}

async function requestOsrmRoute(origin, destination) {
  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number(process.env.OSRM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 1000), 10000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildOsrmRouteUrl(origin, destination), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.code !== 'Ok' || !payload?.routes?.length) {
      const error = new Error(payload?.message || payload?.code || 'OSRM route lookup failed');
      error.code = payload?.code === 'NoRoute' ? 'NO_ROUTE' : 'OSRM_UNAVAILABLE';
      throw error;
    }

    const route = payload.routes[0];
    return {
      distanceMeters: Number(route.distance),
      durationSeconds: Number(route.duration),
      etaMinutes: Math.max(1, Math.ceil(Number(route.duration) / 60)),
      geometry: route.geometry || null,
      dataVersion: payload.data_version || null
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('OSRM route lookup timed out'), { code: 'OSRM_TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDispatchContext(dispatchId) {
  const { data: dispatch, error: dispatchError } = await supabaseAdmin
    .from('donor_dispatches')
    .select('id, request_id, donor_id, status')
    .eq('id', dispatchId)
    .maybeSingle();

  if (dispatchError) {
    throw Object.assign(new Error(dispatchError.message || 'Failed to load dispatch'), { code: 'DATABASE_ERROR' });
  }
  if (!dispatch) {
    throw Object.assign(new Error('Donor dispatch not found'), { code: 'NOT_FOUND' });
  }

  const [{ data: request, error: requestError }, { data: donor, error: donorError }] = await Promise.all([
    supabaseAdmin
      .from('emergency_requests')
      .select('id, hospital_id, hospital_latitude, hospital_longitude')
      .eq('id', dispatch.request_id)
      .maybeSingle(),
    supabaseAdmin
      .from('donors')
      .select('id, user_id, current_latitude, current_longitude')
      .eq('id', dispatch.donor_id)
      .maybeSingle()
  ]);

  if (requestError || donorError) {
    throw Object.assign(new Error(requestError?.message || donorError?.message || 'Failed to load dispatch route context'), { code: 'DATABASE_ERROR' });
  }
  if (!request) throw Object.assign(new Error('Emergency request not found'), { code: 'NOT_FOUND' });
  if (!donor) throw Object.assign(new Error('Donor profile not found'), { code: 'NOT_FOUND' });

  const { data: latestLocation, error: locationError } = await supabaseAdmin
    .from('live_locations')
    .select('latitude, longitude, recorded_at')
    .eq('dispatch_id', dispatchId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (locationError) {
    throw Object.assign(new Error(locationError.message || 'Failed to load donor location'), { code: 'DATABASE_ERROR' });
  }

  const origin = latestLocation
    ? {
        latitude: Number(latestLocation.latitude),
        longitude: Number(latestLocation.longitude),
        recordedAt: latestLocation.recorded_at,
        source: 'LIVE_LOCATION'
      }
    : {
        latitude: Number(donor.current_latitude),
        longitude: Number(donor.current_longitude),
        recordedAt: null,
        source: 'DONOR_PROFILE'
      };

  let destination = {
    latitude: Number(request.hospital_latitude),
    longitude: Number(request.hospital_longitude),
    source: 'EMERGENCY_REQUEST'
  };

  if (!validateCoordinate(destination.latitude, -90, 90) ||
      !validateCoordinate(destination.longitude, -180, 180)) {
    const { data: hospital, error: hospitalError } = await supabaseAdmin
      .from('hospitals')
      .select('latitude, longitude')
      .eq('id', request.hospital_id)
      .maybeSingle();

    if (hospitalError) {
      throw Object.assign(new Error(hospitalError.message || 'Failed to load hospital location'), { code: 'DATABASE_ERROR' });
    }

    destination = {
      latitude: Number(hospital?.latitude),
      longitude: Number(hospital?.longitude),
      source: 'HOSPITAL_PROFILE'
    };
  }

  return { dispatch, request, donor, origin, destination };
}

function assertRouteAccess({ context, user, organization }) {
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { code: 'FORBIDDEN' });

  if (user.role === 'DONOR' && context.donor.user_id === user.id) return;
  if (user.role === 'HOSPITAL' && organization?.hospitalId === context.request.hospital_id) return;

  throw Object.assign(new Error('Unauthorized access to donor dispatch route'), { code: 'FORBIDDEN' });
}

export async function getDonorDispatchRoute({ dispatchId, user, organization }) {
  if (!UUID_RE.test(dispatchId)) {
    throw Object.assign(new Error('dispatchId must be a valid UUID'), { code: 'INVALID_DISPATCH_ID' });
  }

  const context = await loadDispatchContext(dispatchId);
  assertRouteAccess({ context, user, organization });

  if (!['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(context.dispatch.status)) {
    throw Object.assign(new Error('Routing is available after donor acceptance'), { code: 'INVALID_STATE_TRANSITION' });
  }

  if (!validateCoordinate(context.origin.latitude, -90, 90) ||
      !validateCoordinate(context.origin.longitude, -180, 180)) {
    throw Object.assign(new Error('A valid donor location is not available'), { code: 'LOCATION_UNAVAILABLE' });
  }

  if (!validateCoordinate(context.destination.latitude, -90, 90) ||
      !validateCoordinate(context.destination.longitude, -180, 180)) {
    throw Object.assign(new Error('A valid hospital location is not available'), { code: 'DESTINATION_UNAVAILABLE' });
  }

  const route = await requestOsrmRoute(context.origin, context.destination);

  return {
    dispatchId: context.dispatch.id,
    requestId: context.dispatch.request_id,
    status: context.dispatch.status,
    origin: context.origin,
    destination: context.destination,
    distanceMeters: route.distanceMeters,
    distanceKm: Number((route.distanceMeters / 1000).toFixed(2)),
    durationSeconds: route.durationSeconds,
    etaMinutes: route.etaMinutes,
    geometry: route.geometry,
    routingProvider: 'OSRM',
    dataVersion: route.dataVersion
  };
}
