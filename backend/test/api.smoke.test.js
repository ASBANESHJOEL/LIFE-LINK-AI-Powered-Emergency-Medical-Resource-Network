import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

after(() => server.close());

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('GET /api/health returns service health without authentication', async () => {
  const { response, body } = await request('/api/health');

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'LIFE-LINK API');
  assert.equal(body.authProvider, 'Supabase Auth');
  assert.equal(typeof body.timestamp, 'string');
  assert.equal(typeof body.uptimeSeconds, 'number');
});

test('protected hospital endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/hospital/ping');

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('protected blood-bank endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/blood-bank/ping');

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('protected donor endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/donor/ping');

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('protected emergency-request endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blood_group: 'O_POSITIVE',
      quantity: 2,
      urgency: 'CRITICAL'
    })
  });

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('protected peer-transfer acceptance endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/transfer-offers/00000000-0000-4000-8000-000000000000/accept', {
    method: 'POST'
  });

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

test('protected donor-dispatch next-batch endpoint rejects unauthenticated access', async () => {
  const { response, body } = await request('/api/requests/00000000-0000-4000-8000-000000000000/donor-dispatches/next-batch', {
    method: 'POST'
  });

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});
