import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => server.close());

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

test('POST /api/auth/signup-check: rejects missing or non-string email with 400', async () => {
  const { response, body } = await post('/api/auth/signup-check', {});
  assert.equal(response.status, 400);
  assert.equal(body.error, 'INVALID_INPUT');
});

test('POST /api/auth/signup-check: rejects malformed email format with 400', async () => {
  const { response, body } = await post('/api/auth/signup-check', { email: 'not-an-email' });
  assert.equal(response.status, 400);
  assert.equal(body.error, 'INVALID_EMAIL');
});

test('POST /api/auth/signup-check: returns exists: false for unknown email', async () => {
  const { response, body } = await post('/api/auth/signup-check', { email: 'completely-unknown-email-999@test.com' });
  assert.equal(response.status, 200);
  assert.equal(body.exists, false);
});

test('POST /api/auth/signup-check: detects development mock donor when enabled', async () => {
  const devEmail = process.env.LIFELINK_DEV_EMAIL || 'dev-donor@lifelink.test';
  const { response, body } = await post('/api/auth/signup-check', { email: devEmail });
  assert.equal(response.status, 200);
  // In dev auth environment, synthetic donor is recognized
  if (process.env.LIFELINK_DEV_AUTH_ENABLED === 'true') {
    assert.equal(body.exists, true);
    assert.equal(body.role, 'DONOR');
  }
});

test('POST /api/auth/signup-check: response does not leak internal sensitive secrets or IDs', async () => {
  const { body } = await post('/api/auth/signup-check', { email: 'test@example.com' });
  assert.equal(body.token, undefined);
  assert.equal(body.id, undefined);
  assert.equal(body.password, undefined);
  assert.equal(body.secret, undefined);
});
