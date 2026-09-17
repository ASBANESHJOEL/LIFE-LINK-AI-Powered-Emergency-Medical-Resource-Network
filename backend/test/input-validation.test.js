import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

after(() => server.close());

async function postRequest(body) {
  const response = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

test('malformed JSON is rejected by the HTTP parser', async () => {
  const response = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid'
  });

  assert.equal(response.status, 400);
});

test('unauthenticated requests never reach hospital input validation', async () => {
  const { response, body } = await postRequest({
    blood_group: 'NOT_A_BLOOD_GROUP',
    quantity: 0,
    resource_type: 'NOT_A_COMPONENT',
    urgency: 'NOT_URGENT'
  });

  assert.equal(response.status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');
});

for (const [name, body] of [
  ['missing blood group', { quantity: 2, urgency: 'CRITICAL' }],
  ['invalid quantity', { blood_group: 'O_POSITIVE', quantity: 0, urgency: 'CRITICAL' }],
  ['fractional quantity', { blood_group: 'O_POSITIVE', quantity: 1.5, urgency: 'CRITICAL' }],
  ['invalid component', { blood_group: 'O_POSITIVE', quantity: 2, resource_type: 'INVALID', urgency: 'CRITICAL' }],
  ['invalid urgency', { blood_group: 'O_POSITIVE', quantity: 2, urgency: 'INVALID' }]
]) {
  test(`${name} remains protected behind authentication`, async () => {
    const { response } = await postRequest(body);
    assert.equal(response.status, 401);
  });
}
