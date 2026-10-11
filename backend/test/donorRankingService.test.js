import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRankingFeatures, calculateDistanceKm } from '../src/services/donorRankingService.js';

test('calculateDistanceKm returns zero for the same coordinates', () => {
  assert.equal(calculateDistanceKm(13, 80, 13, 80), 0);
});

test('calculateDistanceKm rejects invalid coordinates', () => {
  assert.equal(calculateDistanceKm(null, 80, 13, 80), null);
  assert.equal(calculateDistanceKm(95, 80, 13, 80), null);
});

test('buildRankingFeatures uses only prior terminal outcomes and safe smoothed response rate', () => {
  const features = buildRankingFeatures({
    donor: {
      bloodGroup: 'O_NEGATIVE', verified: true, eligibilityStatus: 'ELIGIBLE',
      availabilityStatus: 'AVAILABLE', lastDonationDate: '2026-01-01T00:00:00Z',
    },
    request: {
      blood_group: 'O_NEGATIVE', created_at: '2026-10-01T12:00:00Z',
      urgency: 'CRITICAL', quantity: 2, resource_type: 'WHOLE_BLOOD',
    },
    historyRows: [
      { status: 'ACCEPTED' }, { status: 'DECLINED' }, { status: 'PENDING' },
    ],
    distanceKm: 4.2,
  });
  assert.equal(features.is_exact_blood_match, 1);
  assert.equal(features.is_universal_donor, 1);
  assert.equal(features.donor_history_count, 2);
  assert.equal(features.donor_positive_responses, 1);
  assert.equal(features.donor_response_rate, 3 / 6);
  assert.equal(features.urgency_level, 3);
  assert.equal(features.distance_km, 4.2);
});
