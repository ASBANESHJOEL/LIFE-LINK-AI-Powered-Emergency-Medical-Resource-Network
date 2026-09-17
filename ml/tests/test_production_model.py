"""
LIFE-LINK Production Model (Logistic Regression V1) Unit & Integration Tests
Verifies model integrity, 18-feature schema enforcement, ordering, prediction bounds, and error handling.
"""

import os
import sys
import pytest
import numpy as np
import pandas as pd

# Setup path to ml directory
current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
if ml_dir not in sys.path:
    sys.path.insert(0, ml_dir)
scripts_dir = os.path.join(ml_dir, "scripts")
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

from load_production_model import (
    load_production_model,
    predict_donor_response,
    validate_and_order_features,
    FEATURE_NAMES,
    PRODUCTION_MODEL_NAME,
    get_default_model_path
)


@pytest.fixture
def valid_donor_payload():
    """Provides a valid dictionary containing all 18 production domain features."""
    return {
        "is_exact_blood_match": 1,
        "is_blood_compatible": 1,
        "is_universal_donor": 0,
        "donor_is_verified": 1,
        "donor_is_eligible": 1,
        "donor_is_available": 1,
        "donor_response_rate": 0.85,
        "donor_history_count": 12,
        "donor_positive_responses": 10,
        "days_since_last_donation": 110.0,
        "dispatch_hour": 14,
        "dispatch_day_of_week": 2,
        "is_weekend": 0,
        "is_night_dispatch": 0,
        "is_business_hours": 1,
        "requested_quantity": 2.0,
        "urgency_level": 3,
        "is_resource_blood": 1
    }


@pytest.fixture
def negative_case_payload():
    """Provides a scenario that should strongly predict a decline (target=0)."""
    return {
        "is_exact_blood_match": 0,
        "is_blood_compatible": 0,
        "is_universal_donor": 0,
        "donor_is_verified": 0,
        "donor_is_eligible": 0,
        "donor_is_available": 0,
        "donor_response_rate": 0.10,
        "donor_history_count": 10,
        "donor_positive_responses": 1,
        "days_since_last_donation": 15.0,
        "dispatch_hour": 3,
        "dispatch_day_of_week": 6,
        "is_weekend": 1,
        "is_night_dispatch": 1,
        "is_business_hours": 0,
        "requested_quantity": 5.0,
        "urgency_level": 1,
        "is_resource_blood": 1
    }


def test_model_artifact_exists_and_loads():
    """Verify that donor_response_logistic_v1.joblib exists and loads as a valid scikit-learn Pipeline."""
    model_path = get_default_model_path()
    assert os.path.exists(model_path), f"Model artifact missing at {model_path}"
    
    model = load_production_model(force_reload=True)
    assert model is not None
    assert hasattr(model, "predict")
    assert hasattr(model, "predict_proba")
    assert hasattr(model, "named_steps")
    assert "scaler" in model.named_steps
    assert "classifier" in model.named_steps


def test_expected_feature_count_and_ordering():
    """Verify exactly 18 features in canonical order."""
    assert len(FEATURE_NAMES) == 18
    expected_order = [
        "is_exact_blood_match",
        "is_blood_compatible",
        "is_universal_donor",
        "donor_is_verified",
        "donor_is_eligible",
        "donor_is_available",
        "donor_response_rate",
        "donor_history_count",
        "donor_positive_responses",
        "days_since_last_donation",
        "dispatch_hour",
        "dispatch_day_of_week",
        "is_weekend",
        "is_night_dispatch",
        "is_business_hours",
        "requested_quantity",
        "urgency_level",
        "is_resource_blood"
    ]
    assert FEATURE_NAMES == expected_order


def test_valid_prediction_format_and_bounds(valid_donor_payload):
    """Verify prediction produces binary {0, 1}, probability within [0.0, 1.0], and model version marker."""
    result = predict_donor_response(valid_donor_payload)
    
    assert isinstance(result, dict)
    assert "prediction" in result
    assert "probability" in result
    assert "model_version" in result
    
    assert result["prediction"] in [0, 1]
    assert 0.0 <= result["probability"] <= 1.0
    assert result["model_version"] == "donor_response_logistic_v1"
    assert result["prediction"] == 1
    assert result["probability"] > 0.5


def test_negative_scenario_prediction(negative_case_payload):
    """Verify negative dispatch scenario predicts 0 with low probability."""
    result = predict_donor_response(negative_case_payload)
    assert result["prediction"] == 0
    assert result["probability"] < 0.5


def test_dataframe_input_support(valid_donor_payload):
    """Verify inference works when input is passed as a pandas DataFrame."""
    df_input = pd.DataFrame([valid_donor_payload])
    result = predict_donor_response(df_input)
    assert result["prediction"] in [0, 1]
    assert 0.0 <= result["probability"] <= 1.0


def test_missing_feature_raises_clear_error(valid_donor_payload):
    """Verify that omitting a required feature raises a descriptive ValueError."""
    incomplete = valid_donor_payload.copy()
    del incomplete["is_exact_blood_match"]
    
    with pytest.raises(ValueError) as excinfo:
        predict_donor_response(incomplete)
    
    assert "Missing required production features" in str(excinfo.value)
    assert "is_exact_blood_match" in str(excinfo.value)


def test_null_value_raises_clear_error(valid_donor_payload):
    """Verify that null/NaN values in features raise a descriptive ValueError."""
    corrupted = valid_donor_payload.copy()
    corrupted["donor_response_rate"] = None
    
    with pytest.raises(ValueError) as excinfo:
        predict_donor_response(corrupted)
    
    assert "cannot be null or NaN" in str(excinfo.value)


def test_incorrect_feature_ordering_is_canonically_reordered(valid_donor_payload):
    """Verify that passing dictionary keys out of order is safely reordered before model inference."""
    # Reverse key order in dictionary
    reversed_dict = {k: valid_donor_payload[k] for k in reversed(list(valid_donor_payload.keys()))}
    
    df_reordered = validate_and_order_features(reversed_dict)
    assert list(df_reordered.columns) == FEATURE_NAMES


def test_prediction_determinism(valid_donor_payload):
    """Verify that repeated predictions on the same input are 100% deterministic."""
    res1 = predict_donor_response(valid_donor_payload)
    res2 = predict_donor_response(valid_donor_payload)
    
    assert res1["prediction"] == res2["prediction"]
    assert res1["probability"] == res2["probability"]
    assert res1["model_version"] == res2["model_version"]


def test_custom_threshold(valid_donor_payload):
    """Verify custom classification thresholds adjust the binary prediction."""
    prob = predict_donor_response(valid_donor_payload)["probability"]
    
    # Threshold strictly above probability should predict 0
    res_high_thresh = predict_donor_response(valid_donor_payload, threshold=prob + 0.01)
    assert res_high_thresh["prediction"] == 0
    
    # Threshold strictly below probability should predict 1
    res_low_thresh = predict_donor_response(valid_donor_payload, threshold=max(0.0, prob - 0.01))
    assert res_low_thresh["prediction"] == 1
