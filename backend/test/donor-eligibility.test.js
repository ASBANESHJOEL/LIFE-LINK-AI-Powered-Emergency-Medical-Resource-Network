import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';

const { isCompatibleDonor } = await import('../src/services/donorEligibilityService.js');

const compatibilityCases = [
  ['O_NEGATIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', true],
  ['A_NEGATIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', true],
  ['B_POSITIVE', 'A_POSITIVE', 'RED_BLOOD_CELLS', false],
  ['AB_POSITIVE', 'A_POSITIVE', 'PLASMA', true],
  ['O_POSITIVE', 'A_POSITIVE', 'PLASMA', false],
  ['A_POSITIVE', 'A_POSITIVE', 'WHOLE_BLOOD', true],
  ['O_POSITIVE', 'A_POSITIVE', 'WHOLE_BLOOD', false],
  ['A_POSITIVE', 'A_POSITIVE', 'PLATELETS', true],
  ['B_POSITIVE', 'A_POSITIVE', 'PLATELETS', false],
  ['A_POSITIVE', 'A_POSITIVE', 'UNSUPPORTED', false]
];

for (const [donorBloodGroup, recipientBloodGroup, componentType, expected] of compatibilityCases) {
  test(`compatibility: ${donorBloodGroup} donor -> ${recipientBloodGroup} recipient (${componentType})`, () => {
    assert.equal(
      isCompatibleDonor({ donorBloodGroup, recipientBloodGroup, componentType }),
      expected
    );
  });
}
