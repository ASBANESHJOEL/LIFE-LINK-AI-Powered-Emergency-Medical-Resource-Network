import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

function devAuthEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.LIFELINK_DEV_AUTH_ENABLED === 'true';
}

export async function createDevSession(email, otp) {
  if (!devAuthEnabled()) {
    const error = new Error('Development authentication harness is disabled.');
    error.code = 'DEV_AUTH_DISABLED';
    throw error;
  }

  const expectedEmail = process.env.LIFELINK_DEV_EMAIL?.trim().toLowerCase();
  const expectedOtp = process.env.LIFELINK_DEV_OTP?.trim();
  const donorUserId = process.env.LIFELINK_DEV_DONOR_USER_ID?.trim();

  if (!expectedEmail || !expectedOtp || !donorUserId) {
    const error = new Error('Development authentication harness is not configured.');
    error.code = 'DEV_AUTH_NOT_CONFIGURED';
    throw error;
  }

  if (email?.trim().toLowerCase() !== expectedEmail || otp?.trim() !== expectedOtp) {
    const error = new Error('Invalid development test credentials.');
    error.code = 'DEV_AUTH_INVALID';
    throw error;
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, role, is_active, is_synthetic')
    .eq('id', donorUserId)
    .eq('role', 'DONOR')
    .maybeSingle();

  if (userError) throw userError;
  if (!user || user.is_active === false) {
    const error = new Error('Configured development donor is unavailable.');
    error.code = 'DEV_AUTH_DONOR_UNAVAILABLE';
    throw error;
  }

  const { data: donor, error: donorError } = await supabaseAdmin
    .from('donors')
    .select('id, user_id, name, blood_group, availability_status, eligibility_status, verified, live_location_enabled, current_latitude, current_longitude')
    .eq('user_id', donorUserId)
    .maybeSingle();

  if (donorError) throw donorError;
  if (!donor) {
    const error = new Error('Configured development user has no donor profile.');
    error.code = 'DEV_AUTH_DONOR_PROFILE_MISSING';
    throw error;
  }

  const token = `dev-${crypto.randomBytes(32).toString('hex')}`;
  sessions.set(token, {
    expiresAt: Date.now() + SESSION_TTL_MS,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      is_active: user.is_active,
      is_synthetic: user.is_synthetic,
      donorId: donor.id,
      donorName: donor.name,
      bloodGroup: donor.blood_group,
      availabilityStatus: donor.availability_status,
      eligibilityStatus: donor.eligibility_status,
      verified: donor.verified,
      liveLocationEnabled: donor.live_location_enabled
    }
  });

  return {
    token,
    expiresInSeconds: SESSION_TTL_MS / 1000,
    user: sessions.get(token).user
  };
}

export function resolveDevToken(token) {
  if (!devAuthEnabled() || !token?.startsWith('dev-')) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session.user;
}
