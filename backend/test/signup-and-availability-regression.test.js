import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => server.close());

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('signup-check validates malformed input without authentication', async () => {
  const { response, body } = await request('/api/auth/signup-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'INVALID_EMAIL');
});

test('signup-check remains a public endpoint and never requires a role token', async () => {
  const { response, body } = await request('/api/auth/signup-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'regression-valid@example.com' })
  });

  // A healthy backend reaches the database/auth existence check. If a
  // dependency is temporarily unavailable, it must be a dependency error,
  // not an authorization error.
  assert.ok([200, 503].includes(response.status));
  assert.notEqual(body.error, 'UNAUTHORIZED');
  assert.notEqual(body.error, 'FORBIDDEN');
});
