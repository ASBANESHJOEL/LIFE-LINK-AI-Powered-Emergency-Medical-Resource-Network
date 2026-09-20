import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const router = Router();

/**
 * Basic health check (backwards compatible).
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LIFE-LINK API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    authProvider: 'Supabase Auth',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    ...(req.id ? { requestId: req.id } : {})
  });
});

/**
 * Liveness probe: verifies only that the Node process is running.
 * Strictly does NOT touch the database or external services.
 */
router.get(['/health/liveness', '/liveness'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    ...(req.id ? { requestId: req.id } : {})
  });
});

/**
 * Readiness probe: verifies essential dependencies.
 * Database is required (503 if unreachable).
 * ML inference is an optional/degraded dependency (remains 200 OK with degraded indicator).
 */
router.get(['/health/readiness', '/readiness'], async (req, res) => {
  const dependencies = {
    database: 'unknown',
    ml: 'unknown'
  };

  // 1. Check PostgreSQL / Supabase connectivity
  try {
    const dbTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database ping timeout')), 2500)
    );

    const dbQuery = supabaseAdmin
      .from('emergency_requests')
      .select('id')
      .limit(1);

    const { error: dbError } = await Promise.race([dbQuery, dbTimeout]);
    if (dbError) {
      dependencies.database = 'error';
    } else {
      dependencies.database = 'ok';
    }
  } catch (_err) {
    dependencies.database = 'error';
  }

  // 2. Check ML service connectivity (optional/graceful fallback)
  const mlApiUrl = (process.env.ML_API_URL || '').replace(/\/$/, '');
  if (!mlApiUrl) {
    dependencies.ml = 'degraded';
  } else {
    try {
      const mlController = new AbortController();
      const mlTimeout = setTimeout(() => mlController.abort(), 1500);

      const mlResp = await fetch(`${mlApiUrl}/health`, {
        signal: mlController.signal
      }).catch(() => null);

      clearTimeout(mlTimeout);

      if (mlResp && mlResp.ok) {
        dependencies.ml = 'ok';
      } else {
        dependencies.ml = 'degraded';
      }
    } catch (_err) {
      dependencies.ml = 'degraded';
    }
  }

  const isDatabaseReady = dependencies.database === 'ok';
  const overallStatus = isDatabaseReady
    ? (dependencies.ml === 'ok' ? 'ok' : 'degraded')
    : 'error';

  const httpStatus = isDatabaseReady ? 200 : 503;

  return res.status(httpStatus).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies,
    ...(req.id ? { requestId: req.id } : {})
  });
});

export default router;
