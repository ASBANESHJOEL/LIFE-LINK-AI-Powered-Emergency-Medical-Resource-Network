import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';

const integrationEnabled = process.env.LIFE_LINK_INTEGRATION === 'true';
const hospitalToken = process.env.TEST_HOSPITAL_ACCESS_TOKEN;
const bloodBankToken = process.env.TEST_BLOOD_BANK_ACCESS_TOKEN;
const donorToken = process.env.TEST_DONOR_ACCESS_TOKEN;

const server = app.listen(0);
const baseUrl = await new Promise((resolve) => {
  server.once('listening', () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  });
});

after(() => server.close());

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

const skipReason = 'Set LIFE_LINK_INTEGRATION=true and provide the required role access tokens to run live authenticated integration tests.';

test('authenticated hospital identity resolves through Supabase Auth and public.users', { skip: !integrationEnabled || !hospitalToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/auth/me', {
    headers: authHeaders(hospitalToken)
  });

  assert.equal(response.status, 200);
  assert.equal(body.user?.role, 'HOSPITAL');
  assert.equal(body.organization?.hospitalId ? typeof body.organization.hospitalId : 'undefined', 'string');
});

test('authenticated hospital can reach its protected route', { skip: !integrationEnabled || !hospitalToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/hospital/ping', {
    headers: authHeaders(hospitalToken)
  });

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test('authenticated blood-bank identity is role-bound', { skip: !integrationEnabled || !bloodBankToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/auth/me', {
    headers: authHeaders(bloodBankToken)
  });

  assert.equal(response.status, 200);
  assert.equal(body.user?.role, 'BLOOD_BANK');
  assert.equal(body.organization?.bloodBankId ? typeof body.organization.bloodBankId : 'undefined', 'string');
});

test('authenticated blood bank can reach its protected route', { skip: !integrationEnabled || !bloodBankToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/blood-bank/ping', {
    headers: authHeaders(bloodBankToken)
  });

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test('hospital token cannot cross role boundary into blood-bank endpoint', { skip: !integrationEnabled || !hospitalToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/blood-bank/ping', {
    headers: authHeaders(hospitalToken)
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('blood-bank token cannot cross role boundary into hospital endpoint', { skip: !integrationEnabled || !bloodBankToken ? skipReason : false }, async () => {
  const { response, body } = await request('/api/hospital/ping', {
    headers: authHeaders(bloodBankToken)
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, 'FORBIDDEN');
});

test('donor token remains outside hospital and blood-bank privileged routes', { skip: !integrationEnabled || !donorToken ? skipReason : false }, async () => {
  const me = await request('/api/auth/me', {
    headers: authHeaders(donorToken)
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user?.role, 'DONOR');

  const hospital = await request('/api/hospital/ping', {
    headers: authHeaders(donorToken)
  });
  assert.equal(hospital.response.status, 403);
  assert.equal(hospital.body.error, 'FORBIDDEN');

  const bloodBank = await request('/api/blood-bank/ping', {
    headers: authHeaders(donorToken)
  });
  assert.equal(bloodBank.response.status, 403);
  assert.equal(bloodBank.body.error, 'FORBIDDEN');
});
