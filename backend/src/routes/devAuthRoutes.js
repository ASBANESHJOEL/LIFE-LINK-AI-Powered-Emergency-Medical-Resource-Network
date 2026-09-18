import express from 'express';
import { createDevSession } from '../services/devAuthService.js';

const router = express.Router();

router.post('/dev-login', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const result = await createDevSession(email, otp);
    return res.json({
      ...result,
      developmentOnly: true
    });
  } catch (error) {
    const statusByCode = {
      DEV_AUTH_DISABLED: 404,
      DEV_AUTH_NOT_CONFIGURED: 503,
      DEV_AUTH_INVALID: 401,
      DEV_AUTH_DONOR_UNAVAILABLE: 503,
      DEV_AUTH_DONOR_PROFILE_MISSING: 503
    };

    return res.status(statusByCode[error.code] || 500).json({
      error: error.code || 'DEV_AUTH_ERROR',
      message: error.message || 'Development authentication failed.'
    });
  }
});

export default router;
