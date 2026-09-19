import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const integrationEnabled = process.env.LIFE_LINK_INTEGRATION === 'true';

if (integrationEnabled) {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
}

const hospitalAToken = process.env.TEST_HOSPITAL_A_TOKEN;
const hospitalBToken = process.env.TEST_HOSPITAL_B_TOKEN;
const bloodBankAToken = process.env.TEST_BLOOD_BANK_A_TOKEN;
const bloodBankBToken = process.env.TEST_BLOOD_BANK_B_TOKEN;
const donorAToken = process.env.TEST_DONOR_A_TOKEN;
const donorBToken = process.env.TEST_DONOR_B_TOKEN;

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'test-anon-key';

// ============================================================================
// PREFLIGHT CHECK & TOKEN REPORTING
// ============================================================================

const requiredRoleTokens = [
  { key: 'TEST_HOSPITAL_A_TOKEN', val: hospitalAToken, role: 'Hospital A' },
  { key: 'TEST_HOSPITAL_B_TOKEN', val: hospitalBToken, role: 'Hospital B' },
  { key: 'TEST_BLOOD_BANK_A_TOKEN', val: bloodBankAToken, role: 'Blood Bank A' },
  { key: 'TEST_BLOOD_BANK_B_TOKEN', val: bloodBankBToken, role: 'Blood Bank B' },
  { key: 'TEST_DONOR_A_TOKEN', val: donorAToken, role: 'Donor A' },
  { key: 'TEST_DONOR_B_TOKEN', val: donorBToken, role: 'Donor B' }
];

const missingRoleTokens = requiredRoleTokens.filter((t) => !t.val).map((t) => t.key);
const presentRoleTokens = requiredRoleTokens.filter((t) => Boolean(t.val)).map((t) => t.key);

if (integrationEnabled) {
  console.log('\n================================================================');
  console.log('  LIFE-LINK RLS INTEGRATION TEST PREFLIGHT REPORT');
  console.log('================================================================');
  console.log(`  Integration Mode: LIFE_LINK_INTEGRATION=true`);
  console.log(`  Supabase URL:     ${supabaseUrl}`);
  console.log(`  Tokens Present:   ${presentRoleTokens.length} / 6`);
  if (missingRoleTokens.length > 0) {
    console.log(`  Missing Required Role Tokens (${missingRoleTokens.length}):`);
    for (const tokenName of missingRoleTokens) {
      console.log(`    - ${tokenName}`);
    }
    console.log('  Notice: Multi-tenant live assertions will be SKIPPED due to missing tokens.');
  } else {
    console.log('  All 6 role tokens configured. Executing LIVE tenant isolation assertions.');
  }
  console.log('================================================================\n');
}

function getSkipReason(neededTokens = []) {
  if (!integrationEnabled) {
    return 'Set LIFE_LINK_INTEGRATION=true and supply multi-tenant role tokens to run live database RLS execution tests.';
  }
  const missing = neededTokens.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return `[PREFLIGHT: MISSING TOKENS] Missing: ${missing.join(', ')}. Supply valid JWTs in environment variables to execute.`;
  }
  return false;
}

function clientForToken(token) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

const adminClient = createClient(supabaseUrl, supabaseSecretKey || 'test-secret-key', {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ============================================================================
// 1. MIGRATION STRUCTURE & STATIC SECURITY VERIFICATION
// ============================================================================

test('RLS Migration: 20260919_harden_tenant_isolation_rls.sql structure and non-destructiveness', () => {
  const migrationPath = path.resolve(__dirname, '../db/migrations/20260919_harden_tenant_isolation_rls.sql');
  assert.equal(fs.existsSync(migrationPath), true, 'Migration file must exist');

  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify non-destructive rules
  assert.equal(/\bDROP\s+TABLE\b/i.test(sql), false, 'Must not drop tables');
  assert.equal(/\bDROP\s+COLUMN\b/i.test(sql), false, 'Must not drop columns');
  assert.equal(/\bTRUNCATE\b/i.test(sql), false, 'Must not truncate tables');

  // Verify hardened SECURITY DEFINER functions with SET search_path = ''
  assert.equal(sql.includes("FUNCTION public.get_auth_hospital_ids()"), true);
  assert.equal(sql.includes("FUNCTION public.get_auth_blood_bank_ids()"), true);
  assert.equal(sql.includes("FUNCTION public.get_auth_donor_ids()"), true);
  assert.equal(sql.includes("SET search_path = ''"), true, "Must pin SET search_path = ''");

  // Verify explicit RLS enabled on all target core tables
  const targetTables = [
    'users',
    'organization_members',
    'hospitals',
    'blood_banks',
    'donors',
    'emergency_requests',
    'donor_dispatches',
    'blood_inventory',
    'audit_logs',
    'refill_requests'
  ];

  for (const table of targetTables) {
    assert.equal(
      sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
      true,
      `Table ${table} must enable RLS`
    );
  }

  // Verify self-escalation protection on users
  assert.equal(sql.includes('user_select_own_profile'), true);
  assert.equal(sql.includes('deny_authenticated_update_users'), true);
  assert.equal(sql.includes('deny_authenticated_insert_users'), true);
  assert.equal(sql.includes('deny_authenticated_delete_users'), true);

  // Verify inventory mutation protection
  assert.equal(sql.includes('blood_bank_select_own_inventory'), true);
  assert.equal(sql.includes('hospital_select_available_inventory'), true);
  assert.equal(sql.includes('deny_authenticated_insert_blood_inventory'), true);
  assert.equal(sql.includes('deny_authenticated_update_blood_inventory'), true);
  assert.equal(sql.includes('deny_authenticated_delete_blood_inventory'), true);

  // Verify backend-only operational tables
  assert.equal(sql.includes('deny_anon_audit_logs'), true);
  assert.equal(sql.includes('deny_authenticated_audit_logs'), true);
  assert.equal(sql.includes('deny_anon_refill_requests'), true);
  assert.equal(sql.includes('deny_authenticated_refill_requests'), true);
});

test('RLS Static: Blood inventory visibility boundary and mutation lockdown policies', () => {
  const migrationPath = path.resolve(__dirname, '../db/migrations/20260919_harden_tenant_isolation_rls.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // Verify hospital discovery policy
  assert.equal(sql.includes('CREATE POLICY hospital_select_available_inventory ON public.blood_inventory'), true);
  assert.equal(sql.includes('available_units > 0'), true, 'Hospital discovery requires available_units > 0');
  assert.equal(sql.includes('get_auth_hospital_ids()'), true, 'Hospital discovery requires active hospital membership');

  // Verify blood bank isolated inventory policy
  assert.equal(sql.includes('CREATE POLICY blood_bank_select_own_inventory ON public.blood_inventory'), true);
  assert.equal(sql.includes('blood_bank_id IN (SELECT public.get_auth_blood_bank_ids())'), true);

  // Verify direct client mutations are completely denied
  assert.equal(sql.includes('CREATE POLICY deny_authenticated_insert_blood_inventory ON public.blood_inventory'), true);
  assert.equal(sql.includes('CREATE POLICY deny_authenticated_update_blood_inventory ON public.blood_inventory'), true);
  assert.equal(sql.includes('CREATE POLICY deny_authenticated_delete_blood_inventory ON public.blood_inventory'), true);
});

// ============================================================================
// 2. REQUIRED POSITIVE TESTS (RUN WHEN TOKENS CONFIGURED)
// ============================================================================

test('1. Hospital A can SELECT its own emergency request', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN']) }, async () => {
  const clientA = clientForToken(hospitalAToken);
  const { data, error } = await clientA.from('emergency_requests').select('id, hospital_id, status').limit(5);
  assert.equal(error, null, 'Hospital A must select emergency_requests without error');
  assert.equal(Array.isArray(data), true);
  for (const req of data) {
    assert.ok(req.hospital_id, 'Request must have hospital_id');
  }
});

test('2. Hospital A can SELECT its own request dispatches', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN']) }, async () => {
  const clientA = clientForToken(hospitalAToken);
  const { data, error } = await clientA.from('donor_dispatches').select('id, request_id, status').limit(5);
  assert.equal(error, null, 'Hospital A must query dispatches without error');
  assert.equal(Array.isArray(data), true);
});

test('3. Blood Bank A can SELECT its own inventory', { skip: getSkipReason(['TEST_BLOOD_BANK_A_TOKEN']) }, async () => {
  const clientA = clientForToken(bloodBankAToken);
  const { data, error } = await clientA.from('blood_inventory').select('id, blood_bank_id, available_units').limit(5);
  assert.equal(error, null, 'Blood Bank A must select its inventory without error');
  assert.equal(Array.isArray(data), true);
});

test('4. Donor A can SELECT its own donor profile', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);
  const { data, error } = await clientA.from('donors').select('id, user_id, name').limit(1);
  assert.equal(error, null, 'Donor A must select its donor profile without error');
  assert.equal(Array.isArray(data), true);
});

test('5. Donor A can SELECT its own dispatches', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);
  const { data, error } = await clientA.from('donor_dispatches').select('id, donor_id, status').limit(5);
  assert.equal(error, null, 'Donor A must query its dispatches without error');
  assert.equal(Array.isArray(data), true);
});

test('6. Existing live_locations access still works correctly', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);
  const { data, error } = await clientA.from('live_locations').select('id, donor_id, latitude, longitude').limit(5);
  assert.equal(error, null, 'Donor A must select live_locations without error');
  assert.equal(Array.isArray(data), true);
});

test('7. Existing notifications access still works correctly', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);
  const { data, error } = await clientA.from('notifications').select('id, user_id, title').limit(5);
  assert.equal(error, null, 'Donor A must select notifications without error');
  assert.equal(Array.isArray(data), true);
});

// ============================================================================
// 3. REQUIRED CROSS-TENANT NEGATIVE TESTS (RUN WHEN TOKENS CONFIGURED)
// ============================================================================

test('8. Hospital A cannot SELECT Hospital B emergency request', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_HOSPITAL_B_TOKEN']) }, async () => {
  const clientB = clientForToken(hospitalBToken);
  const { data: bRequests } = await clientB.from('emergency_requests').select('id, hospital_id').limit(1);

  if (!bRequests?.length) return; // No fixture available
  const hospitalBRequestId = bRequests[0].id;
  const hospitalBId = bRequests[0].hospital_id;

  const clientA = clientForToken(hospitalAToken);
  const { data: aReadResult } = await clientA.from('emergency_requests').select('id').eq('id', hospitalBRequestId);
  assert.equal(aReadResult?.length || 0, 0, 'Hospital A must receive 0 rows when requesting Hospital B request');

  const { data: aFilterResult } = await clientA.from('emergency_requests').select('id').eq('hospital_id', hospitalBId);
  assert.equal(aFilterResult?.length || 0, 0, 'Hospital A must receive 0 rows when filtering by Hospital B hospital_id');
});

test('9. Hospital A cannot UPDATE Hospital B emergency request', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_HOSPITAL_B_TOKEN']) }, async () => {
  const clientB = clientForToken(hospitalBToken);
  const { data: bRequests } = await clientB.from('emergency_requests').select('id').limit(1);

  if (!bRequests?.length) return;
  const hospitalBRequestId = bRequests[0].id;

  const clientA = clientForToken(hospitalAToken);
  const { data, error } = await clientA
    .from('emergency_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', hospitalBRequestId)
    .select();

  assert.equal(data?.length || 0, 0, 'Hospital A update on Hospital B request must affect 0 rows');
});

test('10. Hospital A cannot INSERT an emergency request belonging to Hospital B', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_HOSPITAL_B_TOKEN']) }, async () => {
  const clientB = clientForToken(hospitalBToken);
  const { data: bRequests } = await clientB.from('emergency_requests').select('hospital_id').limit(1);

  if (!bRequests?.length) return;
  const hospitalBId = bRequests[0].hospital_id;

  const clientA = clientForToken(hospitalAToken);
  const { error } = await clientA.from('emergency_requests').insert({
    hospital_id: hospitalBId,
    blood_group: 'O_POSITIVE',
    quantity: 1,
    resource_type: 'WHOLE_BLOOD',
    urgency: 'CRITICAL',
    status: 'OPEN'
  });

  assert.ok(error, 'Inserting request with Hospital B hospital_id must be rejected');
  assert.equal(error?.code, '42501', 'Error code must be 42501 RLS policy violation');
});

test('11. Blood Bank A cannot SELECT Blood Bank B inventory', { skip: getSkipReason(['TEST_BLOOD_BANK_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bInventory } = await clientB.from('blood_inventory').select('id, blood_bank_id').limit(1);

  if (!bInventory?.length) return;
  const bankBId = bInventory[0].blood_bank_id;

  const clientA = clientForToken(bloodBankAToken);
  const { data } = await clientA.from('blood_inventory').select('id').eq('blood_bank_id', bankBId);
  assert.equal(data?.length || 0, 0, 'Blood Bank A must receive 0 rows for Bank B inventory');
});

test('12. Blood Bank A cannot UPDATE Blood Bank B inventory', { skip: getSkipReason(['TEST_BLOOD_BANK_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bInventory } = await clientB.from('blood_inventory').select('id').limit(1);

  if (!bInventory?.length) return;
  const inventoryId = bInventory[0].id;

  const clientA = clientForToken(bloodBankAToken);
  const { data, error } = await clientA
    .from('blood_inventory')
    .update({ available_units: 999 })
    .eq('id', inventoryId)
    .select();

  assert.ok(error || (data?.length || 0) === 0, 'Bank A cannot update Bank B inventory');
});

test('13. Blood Bank A cannot DELETE Blood Bank B inventory', { skip: getSkipReason(['TEST_BLOOD_BANK_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bInventory } = await clientB.from('blood_inventory').select('id').limit(1);

  if (!bInventory?.length) return;
  const inventoryId = bInventory[0].id;

  const clientA = clientForToken(bloodBankAToken);
  const { data, error } = await clientA
    .from('blood_inventory')
    .delete()
    .eq('id', inventoryId)
    .select();

  assert.ok(error || (data?.length || 0) === 0, 'Bank A cannot delete Bank B inventory');
});

test('14. Donor A cannot SELECT Donor B profile', { skip: getSkipReason(['TEST_DONOR_A_TOKEN', 'TEST_DONOR_B_TOKEN']) }, async () => {
  const clientB = clientForToken(donorBToken);
  const { data: bDonors } = await clientB.from('donors').select('id, user_id').limit(1);

  if (!bDonors?.length) return;
  const donorBId = bDonors[0].id;

  const clientA = clientForToken(donorAToken);
  const { data } = await clientA.from('donors').select('id').eq('id', donorBId);
  assert.equal(data?.length || 0, 0, 'Donor A must receive 0 rows when requesting Donor B profile');
});

test('15. Donor A cannot SELECT Donor B dispatch', { skip: getSkipReason(['TEST_DONOR_A_TOKEN', 'TEST_DONOR_B_TOKEN']) }, async () => {
  const clientB = clientForToken(donorBToken);
  const { data: bDispatches } = await clientB.from('donor_dispatches').select('id, donor_id').limit(1);

  if (!bDispatches?.length) return;
  const dispatchId = bDispatches[0].id;

  const clientA = clientForToken(donorAToken);
  const { data } = await clientA.from('donor_dispatches').select('id').eq('id', dispatchId);
  assert.equal(data?.length || 0, 0, 'Donor A must receive 0 rows when requesting Donor B dispatch');
});

test('16. Hospital A cannot SELECT Hospital B dispatches', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_HOSPITAL_B_TOKEN']) }, async () => {
  const clientB = clientForToken(hospitalBToken);
  const { data: bDispatches } = await clientB.from('donor_dispatches').select('id').limit(1);

  if (!bDispatches?.length) return;
  const dispatchId = bDispatches[0].id;

  const clientA = clientForToken(hospitalAToken);
  const { data } = await clientA.from('donor_dispatches').select('id').eq('id', dispatchId);
  assert.equal(data?.length || 0, 0, 'Hospital A must receive 0 rows when requesting Hospital B dispatch');
});

test('17. Direct client access to blood_bank_transfer_offers remains denied', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN']) }, async () => {
  const client = clientForToken(hospitalAToken);
  const { data } = await client.from('blood_bank_transfer_offers').select('*');
  assert.equal(data?.length || 0, 0, 'Direct client access to blood_bank_transfer_offers must return 0 rows');
});

test('18. Direct client access to request_inventory_allocations remains denied', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN']) }, async () => {
  const client = clientForToken(hospitalAToken);
  const { data } = await client.from('request_inventory_allocations').select('*');
  assert.equal(data?.length || 0, 0, 'Direct client access to request_inventory_allocations must return 0 rows');
});

// ============================================================================
// 4. PRIVILEGE ESCALATION & IDENTITY TAMPERING PREVENTION TESTS
// ============================================================================

test('19. Donor/user cannot escalate role to ADMIN', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);

  // Read donor's own user record to establish baseline
  const { data: selfRows, error: selfErr } = await clientA.from('users').select('id, role').limit(1);
  assert.equal(selfErr, null, 'Donor A should be able to read own user record');
  assert.ok(selfRows && selfRows.length > 0, 'Donor A must have a user record');
  const targetUserId = selfRows[0].id;
  const initialRole = selfRows[0].role;

  const { data: beforeUser, error: beforeErr } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', targetUserId)
    .single();
  assert.equal(beforeErr, null);
  assert.notEqual(beforeUser.role, 'ADMIN', 'Initial role must not be ADMIN');

  // Attempt unauthorized role escalation to ADMIN
  const { data: updateData, error: updateError } = await clientA
    .from('users')
    .update({ role: 'ADMIN' })
    .eq('id', targetUserId)
    .select();

  // Mutation must not succeed: must return an error or affect 0 rows
  const mutationBlocked = Boolean(updateError) || !updateData || updateData.length === 0;
  assert.ok(mutationBlocked, 'Direct update to users.role must be blocked');
  if (updateData && updateData.length > 0) {
    assert.notEqual(updateData[0].role, 'ADMIN', 'Updated row must not reflect ADMIN role');
  }

  // Verify post-condition via adminClient: role remains unchanged and non-ADMIN
  const { data: afterUser, error: afterErr } = await adminClient
    .from('users')
    .select('id, role')
    .eq('id', targetUserId)
    .single();
  assert.equal(afterErr, null);
  assert.equal(afterUser.role, initialRole, 'users.role must remain unchanged as DONOR');
  assert.notEqual(afterUser.role, 'ADMIN', 'users.role must not be escalated to ADMIN');
});

test('20. Donor/user cannot change ownership identity fields', { skip: getSkipReason(['TEST_DONOR_A_TOKEN']) }, async () => {
  const clientA = clientForToken(donorAToken);

  // Read donor's own donor profile to establish baseline
  const { data: selfDonors, error: dErr } = await clientA.from('donors').select('id, user_id, verified').limit(1);
  assert.equal(dErr, null, 'Donor A should be able to read own profile');
  assert.ok(selfDonors && selfDonors.length > 0, 'Donor A must have a donor profile');
  const donorId = selfDonors[0].id;
  const originalUserId = selfDonors[0].user_id;
  const originalVerified = selfDonors[0].verified;

  const { data: beforeDonor, error: beforeErr } = await adminClient
    .from('donors')
    .select('id, user_id, verified')
    .eq('id', donorId)
    .single();
  assert.equal(beforeErr, null);
  assert.equal(beforeDonor.user_id, originalUserId);

  // Attempt unauthorized ownership and verification change
  const fakeUserId = '00000000-0000-4000-8000-000000000099';
  const { data: updateData, error: updateError } = await clientA
    .from('donors')
    .update({ user_id: fakeUserId, verified: !originalVerified })
    .eq('id', donorId)
    .select();

  // Mutation must not succeed: must return an error or affect 0 rows
  const mutationBlocked = Boolean(updateError) || !updateData || updateData.length === 0;
  assert.ok(mutationBlocked, 'Direct update to donors identity/verification fields must be blocked');
  if (updateData && updateData.length > 0) {
    assert.notEqual(updateData[0].user_id, fakeUserId, 'user_id must not be changed');
  }

  // Verify post-condition via adminClient: ownership and verification remain unchanged
  const { data: afterDonor, error: afterErr } = await adminClient
    .from('donors')
    .select('id, user_id, verified')
    .eq('id', donorId)
    .single();
  assert.equal(afterErr, null);
  assert.equal(afterDonor.user_id, originalUserId, 'donors.user_id must remain unchanged');
  assert.equal(afterDonor.verified, originalVerified, 'donors.verified must remain unchanged');
});

test('21. Unauthorized inventory ownership changes are rejected', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN']) }, async () => {
  const clientA = clientForToken(hospitalAToken);

  // Identify an inventory record to attempt unauthorized mutation
  const { data: invRows, error: invErr } = await adminClient.from('blood_inventory').select('id, blood_bank_id, available_units').limit(1);
  assert.equal(invErr, null, 'Must read inventory fixture with adminClient');
  if (!invRows?.length) return; // Skip assertion if no fixture loaded
  const targetInventoryId = invRows[0].id;
  const originalBankId = invRows[0].blood_bank_id;
  const originalUnits = invRows[0].available_units;

  // Hospital A attempts unauthorized modification of blood_inventory
  const { data: updateData, error: updateError } = await clientA
    .from('blood_inventory')
    .update({ available_units: originalUnits + 100 })
    .eq('id', targetInventoryId)
    .select();

  // Mutation must not succeed: must return an error or affect 0 rows
  const mutationBlocked = Boolean(updateError) || !updateData || updateData.length === 0;
  assert.ok(mutationBlocked, 'Client update on blood_inventory must be blocked');
  if (updateData && updateData.length > 0) {
    assert.notEqual(updateData[0].available_units, originalUnits + 100, 'available_units must not be modified');
  }

  // Verify post-condition via adminClient: ownership and units remain unchanged
  const { data: afterInventory, error: afterErr } = await adminClient
    .from('blood_inventory')
    .select('id, blood_bank_id, available_units')
    .eq('id', targetInventoryId)
    .single();
  assert.equal(afterErr, null);
  assert.equal(afterInventory.blood_bank_id, originalBankId, 'blood_bank_id must remain unchanged');
  assert.equal(afterInventory.available_units, originalUnits, 'available_units must remain unchanged');
});

// ============================================================================
// 5. BLOOD INVENTORY VISIBILITY BOUNDARY SPECIFIC TESTS
// ============================================================================

test('22. Hospital A can SELECT available inventory (available_units > 0) from peer blood banks (discovery boundary)', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bAvailable } = await clientB
    .from('blood_inventory')
    .select('id, blood_bank_id, available_units')
    .gt('available_units', 0)
    .limit(1);

  if (!bAvailable?.length) return; // No available inventory fixture
  const inventoryId = bAvailable[0].id;

  const clientA = clientForToken(hospitalAToken);
  const { data, error } = await clientA
    .from('blood_inventory')
    .select('id, blood_bank_id, available_units')
    .eq('id', inventoryId);

  assert.equal(error, null, 'Hospital A must select available inventory without error');
  assert.equal(data?.length, 1, 'Hospital A must discover available inventory lot');
  assert.ok(data[0].available_units > 0, 'Discovered units must be > 0');
});

test('23. Hospital A cannot SELECT unavailable inventory (available_units = 0) belonging to other blood banks', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bZero } = await clientB
    .from('blood_inventory')
    .select('id')
    .eq('available_units', 0)
    .limit(1);

  if (!bZero?.length) return; // No 0-unit fixture available
  const zeroInventoryId = bZero[0].id;

  const clientA = clientForToken(hospitalAToken);
  const { data } = await clientA
    .from('blood_inventory')
    .select('id')
    .eq('id', zeroInventoryId);

  assert.equal(data?.length || 0, 0, 'Hospital A must receive 0 rows for depleted (0-unit) inventory');
});

test('24. Hospital A cannot directly mutate discovered inventory', { skip: getSkipReason(['TEST_HOSPITAL_A_TOKEN', 'TEST_BLOOD_BANK_B_TOKEN']) }, async () => {
  const clientB = clientForToken(bloodBankBToken);
  const { data: bAvailable } = await clientB.from('blood_inventory').select('id').limit(1);
  if (!bAvailable?.length) return;
  const inventoryId = bAvailable[0].id;

  const clientA = clientForToken(hospitalAToken);
  const { data, error } = await clientA
    .from('blood_inventory')
    .update({ available_units: 999 })
    .eq('id', inventoryId)
    .select();

  assert.ok(error || (data?.length || 0) === 0, 'Hospital A direct mutation on blood_inventory must fail');
});

// ============================================================================
// 6. SERVICE ROLE BEHAVIOR VERIFICATION
// ============================================================================

test('25. Backend service-role workflows continue working', { skip: !integrationEnabled ? getSkipReason() : false }, async () => {
  const { data: users, error: uErr } = await adminClient.from('users').select('id, role').limit(1);
  assert.equal(uErr, null, 'service_role must query users without RLS restriction');
  assert.equal(Array.isArray(users), true);

  const { data: requests, error: rErr } = await adminClient.from('emergency_requests').select('id, status').limit(1);
  assert.equal(rErr, null, 'service_role must query emergency_requests without RLS restriction');
  assert.equal(Array.isArray(requests), true);

  const { data: inventory, error: iErr } = await adminClient.from('blood_inventory').select('id, available_units').limit(1);
  assert.equal(iErr, null, 'service_role must query blood_inventory without RLS restriction');
  assert.equal(Array.isArray(inventory), true);
});
