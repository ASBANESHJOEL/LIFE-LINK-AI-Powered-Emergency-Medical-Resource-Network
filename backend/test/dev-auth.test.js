import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDevAuthEnabled,
  getSyntheticDonorIdentity,
  issueMockToken,
  validateMockToken
} from '../src/services/devAuthService.js';
import app from '../src/app.js';
import http from 'http';

test('devAuthService: isDevAuthEnabled is strictly false in production', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'production';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';
    assert.strictEqual(isDevAuthEnabled(), false);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('devAuthService: dev auth remains disabled when NODE_ENV=production', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'production';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    // issueMockToken must throw DEV_AUTH_DISABLED
    assert.throws(
      () => issueMockToken(),
      (err) => err.code === 'DEV_AUTH_DISABLED'
    );

    // validateMockToken must reject even if called with any token string
    assert.strictEqual(validateMockToken('dev_mock_1234567890abcdef'), null);
    assert.strictEqual(validateMockToken('mock-donor-token'), null);

    // /api/auth/dev-login must return HTTP 403 in production
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.error, 'DEV_AUTH_DISABLED');
    } finally {
      server.close();
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('devAuthService: getSyntheticDonorIdentity returns server-bound DONOR identity', () => {
  const identity = getSyntheticDonorIdentity();
  assert.strictEqual(identity.role, 'DONOR');
  assert.strictEqual(identity.is_active, true);
  assert.strictEqual(identity.is_synthetic, true);
  assert.ok(identity.id);
  assert.ok(identity.email);
});

test('devAuthService: generated dev_mock_* token authenticates successfully', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'development';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    const session = issueMockToken();
    assert.ok(session.token.startsWith('dev_mock_'));
    assert.strictEqual(session.user.role, 'DONOR');

    const validatedUser = validateMockToken(session.token);
    assert.ok(validatedUser);
    assert.strictEqual(validatedUser.id, session.user.id);
    assert.strictEqual(validatedUser.role, 'DONOR');
    assert.strictEqual(validatedUser.email, session.user.email);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('devAuthService: arbitrary "mock-donor-token" is rejected', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'development';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    // Static unissued token must NOT be accepted
    const result = validateMockToken('mock-donor-token');
    assert.strictEqual(result, null);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('devAuthService: invalid random tokens are rejected', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'development';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    assert.strictEqual(validateMockToken('invalid-fake-token-12345'), null);
    assert.strictEqual(validateMockToken('dev_mock_unissued_random_hex_value'), null);
    assert.strictEqual(validateMockToken(''), null);
    assert.strictEqual(validateMockToken(null), null);
    assert.strictEqual(validateMockToken(undefined), null);
    assert.strictEqual(validateMockToken(12345), null);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});

test('devAuthRoutes: POST /api/auth/dev-login issues token and rejects client-controlled roles', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalDevAuth = process.env.LIFELINK_DEV_AUTH_ENABLED;

  try {
    process.env.NODE_ENV = 'development';
    process.env.LIFELINK_DEV_AUTH_ENABLED = 'true';

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMIN', evilClaim: 'superadmin' })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.token);
      assert.ok(data.token.startsWith('dev_mock_'));
      // Crucial: Client cannot elevate role to ADMIN via dev-login
      assert.strictEqual(data.user.role, 'DONOR');

      // Verify that the issued token works through requireAuth on /api/auth/me
      const meRes = await fetch(`http://localhost:${port}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` }
      });
      assert.strictEqual(meRes.status, 200);
      const meData = await meRes.json();
      assert.strictEqual(meData.user.role, 'DONOR');

      // Verify that arbitrary "mock-donor-token" is rejected on /api/auth/me
      const rejectedRes = await fetch(`http://localhost:${port}/api/auth/me`, {
        headers: { Authorization: 'Bearer mock-donor-token' }
      });
      assert.strictEqual(rejectedRes.status, 401);
    } finally {
      server.close();
    }
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.LIFELINK_DEV_AUTH_ENABLED = originalDevAuth;
  }
});
