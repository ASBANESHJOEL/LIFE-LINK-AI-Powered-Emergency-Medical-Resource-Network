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

test('devAuthService: getSyntheticDonorIdentity returns server-bound DONOR identity', () => {
  const identity = getSyntheticDonorIdentity();
  assert.strictEqual(identity.role, 'DONOR');
  assert.strictEqual(identity.is_active, true);
  assert.strictEqual(identity.is_synthetic, true);
  assert.ok(identity.id);
  assert.ok(identity.email);
});

test('devAuthService: issueMockToken creates temporary in-memory token and validates', () => {
  const session = issueMockToken();
  assert.ok(session.token.startsWith('dev_mock_'));
  assert.strictEqual(session.user.role, 'DONOR');

  const validatedUser = validateMockToken(session.token);
  assert.ok(validatedUser);
  assert.strictEqual(validatedUser.id, session.user.id);
  assert.strictEqual(validatedUser.role, 'DONOR');

  const invalid = validateMockToken('invalid-fake-token-12345');
  assert.strictEqual(invalid, null);
});

test('devAuthRoutes: POST /api/auth/dev-login issues token and rejects client-controlled roles', async () => {
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
    // Crucial: Client cannot elevate role to ADMIN via dev-login
    assert.strictEqual(data.user.role, 'DONOR');
  } finally {
    server.close();
  }
});
