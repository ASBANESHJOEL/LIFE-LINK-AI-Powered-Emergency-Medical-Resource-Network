import express from 'express';
import { isDevAuthEnabled, issueMockToken } from '../services/devAuthService.js';

const router = express.Router();

/**
 * POST /api/auth/dev-login
 * Development-only endpoint to issue a temporary mock donor session.
 * Rejects with 403 in production or when dev auth is disabled.
 * Client-supplied roles are strictly ignored; role is locked to DONOR.
 */
router.post('/auth/dev-login', (req, res) => {
  if (!isDevAuthEnabled()) {
    return res.status(403).json({
      error: 'DEV_AUTH_DISABLED',
      message: 'Development authentication is disabled in this environment'
    });
  }

  try {
    const session = issueMockToken();
    return res.status(200).json(session);
  } catch (err) {
    console.error('[DEV-AUTH] Failed to issue mock token:', err);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to issue development mock token'
    });
  }
});

/**
 * GET /api/auth/dev-status
 * Check if development authentication is enabled.
 */
router.get('/auth/dev-status', (req, res) => {
  return res.status(200).json({
    enabled: isDevAuthEnabled(),
    environment: process.env.NODE_ENV || 'development'
  });
});

export default router;
