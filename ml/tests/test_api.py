"""
LIFE-LINK ML Inference API Unit & Integration Tests
"""

import sys
import os
import pytest
from fastapi.testclient import TestClient

# Add project root and ml root
current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
sys.path.extend([ml_dir, os.path.join(ml_dir, "api")])

from main import app, FEATURE_NAMES

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["feature_count"] == 18
    assert data["model_loaded"] is True


def test_features_endpoint(client):
    response = client.get("/features")
    assert response.status_code == 200
    data = response.json()
    assert data["feature_count"] == 18
    assert data["feature_names"] == FEATURE_NAMES


def test_predict_positive_case(client):
    valid_payload = {
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
    response = client.post("/predict", json=valid_payload)
    assert response.status_code == 200
    data = response.json()
    assert "prediction" in data
    assert data["prediction"] in [0, 1]
    assert 0.0 <= data["probability"] <= 1.0
    assert "model" in data


def test_predict_negative_case(client):
    inconvenient_payload = {
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
    response = client.post("/predict", json=inconvenient_payload)
    assert response.status_code == 200
    data = response.json()
    assert "prediction" in data
    assert data["prediction"] == 0
    assert data["probability"] < 0.5


def test_predict_validation_error_positive_greater_than_history(client):
    invalid_payload = {
        "is_exact_blood_match": 1,
        "is_blood_compatible": 1,
        "is_universal_donor": 0,
        "donor_is_verified": 1,
        "donor_is_eligible": 1,
        "donor_is_available": 1,
        "donor_response_rate": 0.85,
        "donor_history_count": 5,
        "donor_positive_responses": 10,  # Invalid: > history_count
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
    response = client.post("/predict", json=invalid_payload)
    assert response.status_code == 422


def test_predict_missing_feature(client):
    invalid_payload = {
        "is_exact_blood_match": 1,
        "is_blood_compatible": 1
        # Missing all other 16 fields
    }
    response = client.post("/predict", json=invalid_payload)
    assert response.status_code == 422
