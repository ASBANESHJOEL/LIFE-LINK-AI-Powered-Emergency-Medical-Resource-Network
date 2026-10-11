"""Tests for the experimental V2 donor ranker."""
import os
import sys
import numpy as np
import pytest

ML_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)
from scripts.neural_ranker import RANKING_FEATURE_NAMES, build_ranker_pipeline, score_candidates, synthetic_teacher_utility, validate_ranking_features
from scripts.train_neural_ranker import generate_synthetic_scenarios, split_by_scenario


def sample(distance=4.0):
    return {
        "is_exact_blood_match": 1, "is_blood_compatible": 1, "is_universal_donor": 0,
        "donor_is_verified": 1, "donor_is_eligible": 1, "donor_is_available": 1,
        "donor_response_rate": .8, "donor_history_count": 10, "donor_positive_responses": 8,
        "days_since_last_donation": 120., "dispatch_hour": 14, "dispatch_day_of_week": 2,
        "is_weekend": 0, "is_night_dispatch": 0, "is_business_hours": 1,
        "requested_quantity": 2., "urgency_level": 3, "is_resource_blood": 1, "distance_km": distance,
    }


def test_feature_contract_has_distance_and_all_v1_features():
    assert len(RANKING_FEATURE_NAMES) == 19
    assert RANKING_FEATURE_NAMES[-1] == "distance_km"


def test_validation_rejects_missing_extra_nonfinite_and_negative_distance():
    x = sample()
    with pytest.raises(ValueError, match="feature mismatch"):
        validate_ranking_features({k: v for k, v in x.items() if k != "distance_km"})
    with pytest.raises(ValueError, match="unexpected"):
        validate_ranking_features({**x, "donor_name": "private"})
    with pytest.raises(ValueError, match="finite"):
        validate_ranking_features({**x, "distance_km": float("nan")})
    with pytest.raises(ValueError, match="negative"):
        validate_ranking_features({**x, "distance_km": -1})


def test_synthetic_data_is_reproducible_and_splits_by_scenario():
    a = generate_synthetic_scenarios(8, 3, 11)
    b = generate_synthetic_scenarios(8, 3, 11)
    assert a.equals(b)
    train, val, test = split_by_scenario(a, 11)
    sets = [set(df.scenario_id) for df in (train, val, test)]
    assert all(not sets[i].intersection(sets[j]) for i in range(3) for j in range(i + 1, 3))


def test_teacher_prefers_nearer_candidate_when_other_features_match():
    assert synthetic_teacher_utility(sample(2)) > synthetic_teacher_utility(sample(30))


def test_mlp_scores_candidates_and_returns_stable_order():
    data = generate_synthetic_scenarios(25, 4, 9)
    model = build_ranker_pipeline(9)
    model.fit(data[RANKING_FEATURE_NAMES], data["target_utility"])
    ranked = score_candidates([sample(20), sample(2), sample(8)], {"model": model})
    assert [x["rank"] for x in ranked] == [1, 2, 3]
    assert len({x["candidate_index"] for x in ranked}) == 3
    assert all(np.isfinite(x["score"]) for x in ranked)


def test_empty_candidate_list_returns_empty():
    assert score_candidates([], {"model": build_ranker_pipeline()}) == []
