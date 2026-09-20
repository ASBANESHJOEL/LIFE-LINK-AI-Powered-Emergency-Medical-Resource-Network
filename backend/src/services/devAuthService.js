import crypto from 'crypto';

/**
 * In-memory storage for temporary development mock tokens.
 * Tokens expire automatically after 2 hours or upon server restart.
 *
 * IMPORTANT: this mechanism is strictly disabled when NODE_ENV=production.
 */
const mockTokenStore = new Map();
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const DEV_ROLES = ['DONOR', 'HOSPITAL', 'BLOOD_BANK', 'ADMIN'];

const DEFAULT_DEV_IDENTITIES = {
  DONOR: {
    id: 'd463aba1-5e53-4f80-b157-129f5d102bd7',
    email: 'donor002@lifelink.test'
  },
  HOSPITAL: {
    id: '10051d89-e8e0-4086-9bf3-7d02f0462c42',
    email: 'hospital.staff021@lifelink.test'
  },
  BLOOD_BANK: {
    id: '5f14b969-57b7-44f5-8412-ed5a2fe18f33',
    email: 'bank.staff002@lifelink.test'
  },
  ADMIN: {
    id: 'b193193d-24ea-4d94-b582-3232e92c60fa',
    email: 'hospital.staff010@lifelink.test'
  }
};

export function isDevAuthEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.LIFELINK_DEV_AUTH_ENABLED === 'true';
}

function normalizeRole(role) {
  const normalized = String(role || '').trim().toUpperCase();
  return DEV_ROLES.includes(normalized) ? normalized : null;
}

export function getSyntheticIdentity(role = 'DONOR') {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) {
    const err = new Error('Unsupported development role');
    err.code = 'INVALID_DEV_ROLE';
    throw err;
  }

  const fallback = DEFAULT_DEV_IDENTITIES[normalizedRole];

  const envConfig = {
    DONOR: {
      id: process.env.LIFELINK_DEV_DONOR_USER_ID,
      email: process.env.LIFELINK_DEV_EMAIL
    },
    HOSPITAL: {
      id: process.env.LIFELINK_DEV_HOSPITAL_USER_ID,
      email: process.env.LIFELINK_DEV_HOSPITAL_EMAIL
    },
    BLOOD_BANK: {
      id: process.env.LIFELINK_DEV_BLOOD_BANK_USER_ID,
      email: process.env.LIFELINK_DEV_BLOOD_BANK_EMAIL
    },
    ADMIN: {
      id: process.env.LIFELINK_DEV_ADMIN_USER_ID,
      email: process.env.LIFELINK_DEV_ADMIN_EMAIL
    }
  }[normalizedRole];

  return {
    id: envConfig.id || fallback.id,
    email: envConfig.email || fallback.email,
    role: normalizedRole,
    is_active: true,
    is_synthetic: true
  };
}

export function getSyntheticDonorIdentity() {
  return getSyntheticIdentity('DONOR');
}

export function issueMockToken(role = 'DONOR') {
  if (!isDevAuthEnabled()) {
    const err = new Error('Development authentication is disabled in this environment');
    err.code = 'DEV_AUTH_DISABLED';
    throw err;
  }

  const user = getSyntheticIdentity(role);
  const token = `dev_mock_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  mockTokenStore.set(token, { user, expiresAt });

  return {
    token,
    user,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function validateMockToken(token) {
  if (!isDevAuthEnabled() || !token || typeof token !== 'string') {
    return null;
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

export function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, record] of mockTokenStore.entries()) {
    if (now > record.expiresAt) {
      mockTokenStore.delete(token);
    }
  }
}
