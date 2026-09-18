import crypto from 'crypto';

/**
 * In-memory storage for temporary development mock tokens.
 * Tokens expire automatically after 2 hours or upon server restart.
 */
const mockTokenStore = new Map();
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Returns whether mock donor authentication is active.
 * STRICTLY disabled in production or if LIFELINK_DEV_AUTH_ENABLED !== 'true'.
 */
export function isDevAuthEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.LIFELINK_DEV_AUTH_ENABLED === 'true';
}

/**
 * Returns the server-bound synthetic donor profile.
 * Identity is locked to server-side environment variables and cannot be overridden by clients.
 */
export function getSyntheticDonorIdentity() {
  return {
    id: process.env.LIFELINK_DEV_DONOR_USER_ID || '00dc7f94-604e-4b15-b69a-995075fbdb64',
    email: process.env.LIFELINK_DEV_EMAIL || 'dev-donor@lifelink.test',
    role: 'DONOR',
    is_active: true,
    is_synthetic: true
  };
}

/**
 * Issues a temporary, in-memory mock token for development testing.
 */
export function issueMockToken() {
  if (!isDevAuthEnabled()) {
    const err = new Error('Development authentication is disabled in this environment');
    err.code = 'DEV_AUTH_DISABLED';
    throw err;
  }

  const token = `dev_mock_${crypto.randomBytes(24).toString('hex')}`;
  const user = getSyntheticDonorIdentity();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  mockTokenStore.set(token, { user, expiresAt });

  return {
    token,
    user,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

/**
 * Validates a development mock token.
 * Returns the trusted user profile if valid and unexpired, null otherwise.
 */
export function validateMockToken(token) {
  if (!isDevAuthEnabled() || !token || typeof token !== 'string') {
    return null;
  }

  // Fast-path support for static dev token used in local CLI / harness
  if (token === 'mock-donor-token') {
    return getSyntheticDonorIdentity();
  }

  const record = mockTokenStore.get(token);
  if (!record) {
    return null;
  }

  if (Date.now() > record.expiresAt) {
    mockTokenStore.delete(token);
    return null;
  }

  return record.user;
}

/**
 * Clears expired tokens from memory periodically.
 */
export function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, record] of mockTokenStore.entries()) {
    if (now > record.expiresAt) {
      mockTokenStore.delete(token);
    }
  }
}
