import express from 'express';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { isDevAuthEnabled } from '../services/devAuthService.js';

const router = express.Router();

/**
 * POST /api/auth/signup-check
 * Securely checks whether an account already exists in the LIFE-LINK registry
 * for the specified email address, preventing duplicate signups and misleading authentication.
 *
 * Adheres strictly to security requirements:
 * - Does not expose sensitive user information or internal credentials.
 * - Normalized email matching against public.users.
 * - Correctly honors development mock auth when active.
 */
router.post('/auth/signup-check', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'A valid email address is required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: 'Invalid email format.'
      });
    }

    // Development mock auth detection
    if (
      isDevAuthEnabled() &&
      cleanEmail === (process.env.LIFELINK_DEV_EMAIL || 'dev-donor@lifelink.test').toLowerCase()
    ) {
      return res.status(200).json({
        exists: true,
        role: 'DONOR',
        is_active: true,
        message: 'An account already exists with this email.'
      });
    }

    // Query public.users using server-side supabaseAdmin
    const { data: dbUser, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active')
      .ilike('email', cleanEmail)
      .maybeSingle();

    if (dbError) {
      console.error('[AUTH] Error checking user existence:', dbError);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Failed to verify account status'
      });
    }

    if (dbUser) {
      return res.status(200).json({
        exists: true,
        role: dbUser.role,
        is_active: dbUser.is_active,
        message: 'An account already exists with this email.'
      });
    }

    return res.status(200).json({
      exists: false
    });
  } catch (err) {
    console.error('[AUTH] Unexpected error in signup-check:', err);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to verify account status'
    });
  }
});

export default router;
