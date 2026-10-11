"""API tests for the protected V2 ranking endpoint."""
import os
import sys

from fastapi.testclient import TestClient

ML_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)
from api import main as api_main


def payload(eligible=1, distance=2.0, donor_id="donor-a"):
    features = {
        "is_exact_blood_match": 1, "is_blood_compatible": 1, "is_universal_donor": 0,
        "donor_is_verified": 1, "donor_is_eligible": eligible, "donor_is_available": 1,
        "donor_response_rate": .8, "donor_history_count": 10, "donor_positive_responses": 8,
        "days_since_last_donation": 120., "dispatch_hour": 14, "dispatch_day_of_week": 2,
        "is_weekend": 0, "is_night_dispatch": 0, "is_business_hours": 1,
        "requested_quantity": 2., "urgency_level": 3, "is_resource_blood": 1,
    }
    return {"donor_id": donor_id, "distance_km": distance, "features": features}


def test_rank_requires_server_key(monkeypatch):
    monkeypatch.delenv("ML_RANKING_API_KEY", raising=False)
    with TestClient(api_main.app) as client:
        response = client.post("/rank", json={"candidates": [payload()]})
    assert response.status_code == 503


def test_rank_rejects_wrong_key(monkeypatch):
    monkeypatch.setenv("ML_RANKING_API_KEY", "test-secret")
    with TestClient(api_main.app) as client:
        response = client.post("/rank", json={"candidates": [payload()]}, headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_rank_filters_ineligible_candidates_before_inference(monkeypatch):
    monkeypatch.setenv("ML_RANKING_API_KEY", "test-secret")
    class FakeModel:
        def predict(self, frame):
            return [float(-row["distance_km"]) for _, row in frame.iterrows()]
    monkeypatch.setattr(api_main, "load_neural_ranker", lambda: {
        "model_version": "donor_ranker_mlp_v2",
        "feature_names": [*api_main.FEATURE_NAMES, "distance_km"],
        "model": FakeModel(),
    })
    with TestClient(api_main.app) as client:
        response = client.post("/rank", json={"candidates": [
            payload(1, 10, "far"), payload(1, 2, "near"), payload(0, 1, "ineligible")
        ]}, headers={"Authorization": "Bearer test-secret"})
    assert response.status_code == 200
    data = response.json()
    assert [row["donor_id"] for row in data] == ["near", "far"]
    assert all("score" in row and "probability" not in row for row in data)
