import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => server.close());

async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { response, body: await response.json() };
}

test('missing Authorization header is rejected consistently across protected roles', async () => {
  for (const path of ['/api/donor/ping', '/api/hospital/ping', '/api/blood-bank/ping', '/api/admin/ping']) {
    const { response, body } = await get(path);
    assert.equal(response.status, 401, path);
    assert.equal(body.error, 'UNAUTHORIZED', path);
  }
});

test('malformed Authorization schemes are rejected', async () => {
  for (const authorization of ['Basic abc', 'Bearer', 'Bearer    ']) {
    const response = await fetch(`${baseUrl}/api/hospital/ping`, {
      headers: { Authorization: authorization }
    });
    assert.equal(response.status, 401, authorization);
  }
});

test('invalid bearer tokens are rejected before role authorization', async () => {
  const { response, body } = await get('/api/hospital/ping', 'not-a-real-supabase-token');
  assert.equal(response.status, 401);
  assert.equal(body.error, 'INVALID_TOKEN');
});
