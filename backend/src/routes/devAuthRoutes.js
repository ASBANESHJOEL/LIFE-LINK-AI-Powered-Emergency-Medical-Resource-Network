import express from 'express';
import { isDevAuthEnabled, issueMockToken } from '../services/devAuthService.js';

const router = express.Router();

const DEV_ROLES = ['DONOR', 'HOSPITAL', 'BLOOD_BANK', 'ADMIN'];

router.post('/auth/dev-login', (req, res) => {
  if (!isDevAuthEnabled()) {
    return res.status(403).json({
      error: 'DEV_AUTH_DISABLED',
      message: 'Development authentication is disabled in this environment'
    });
  }

  try {
    const role = String(req.body?.role || 'DONOR').trim().toUpperCase();
    if (!DEV_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'INVALID_DEV_ROLE',
        message: 'Supported development roles: DONOR, HOSPITAL, BLOOD_BANK, ADMIN'
      });
    }

    return res.status(200).json(issueMockToken(role));
  } catch (err) {
    console.error('[DEV-AUTH] Failed to issue mock token:', err);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to issue development mock token'
    });
  }
});

router.get('/auth/dev-status', (req, res) => {
  return res.status(200).json({
    enabled: isDevAuthEnabled(),
    environment: process.env.NODE_ENV || 'development',
    roles: isDevAuthEnabled() ? DEV_ROLES : []
  });
});

export default router;
