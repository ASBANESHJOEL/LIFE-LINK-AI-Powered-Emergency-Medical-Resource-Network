"""
LIFE-LINK ML inference service.
V1 is the frozen Logistic Regression baseline; V2 is an opt-in experimental MLP ranker.
Medical eligibility and authorization remain upstream deterministic responsibilities.
"""
import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
if ml_dir not in sys.path:
    sys.path.insert(0, ml_dir)

from scripts.load_production_model import FEATURE_NAMES, PRODUCTION_MODEL_NAME, load_production_model, predict_donor_response, validate_and_order_features
from scripts.neural_ranker import RANKER_MODEL_NAME, load_neural_ranker, score_candidates

MODEL_THRESHOLD = 0.5
production_model: Optional[Any] = None
model_metadata: Dict[str, Any] = {}


def load_inference_model() -> Any:
    global production_model, model_metadata
    try:
        production_model = load_production_model()
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        production_model = None
        raise RuntimeError(f"Production model unavailable: {exc}") from exc
    meta_path = os.path.join(ml_dir, "models", "model_metadata.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as handle:
            model_metadata = json.load(handle)
    return production_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_inference_model()
    yield


app = FastAPI(
    title="LIFE-LINK ML Donor Intelligence API",
    description="V1 response probability and experimental V2 ranking. Medical eligibility is enforced upstream.",
    version="2.0.0", lifespan=lifespan, docs_url="/docs", redoc_url="/redoc",
)
allowed_origins = [x.strip().rstrip("/") for x in os.getenv("ML_ALLOWED_ORIGINS", "").split(",") if x.strip()]
if allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])


class DonorDispatchFeatures(BaseModel):
    is_exact_blood_match: int = Field(..., ge=0, le=1)
    is_blood_compatible: int = Field(..., ge=0, le=1)
    is_universal_donor: int = Field(..., ge=0, le=1)
    donor_is_verified: int = Field(..., ge=0, le=1)
    donor_is_eligible: int = Field(..., ge=0, le=1)
    donor_is_available: int = Field(..., ge=0, le=1)
    donor_response_rate: float = Field(..., ge=0.0, le=1.0)
    donor_history_count: int = Field(..., ge=0)
    donor_positive_responses: int = Field(..., ge=0)
    days_since_last_donation: float = Field(..., ge=0.0)
    dispatch_hour: int = Field(..., ge=0, le=23)
    dispatch_day_of_week: int = Field(..., ge=0, le=6)
    is_weekend: int = Field(..., ge=0, le=1)
    is_night_dispatch: int = Field(..., ge=0, le=1)
    is_business_hours: int = Field(..., ge=0, le=1)
    requested_quantity: float = Field(..., gt=0.0)
    urgency_level: int = Field(..., ge=0, le=3)
    is_resource_blood: int = Field(..., ge=0, le=1)

    @field_validator("donor_positive_responses")
    @classmethod
    def validate_positive_le_history(cls, value: int, info):
        history = info.data.get("donor_history_count")
        if history is not None and value > history:
            raise ValueError("donor_positive_responses cannot exceed donor_history_count")
        return value


class PredictionResponse(BaseModel):
    prediction: int
    probability: float = Field(..., ge=0.0, le=1.0)
    model: str


class RankingCandidate(BaseModel):
    donor_id: str = Field(..., min_length=1, max_length=128)
    distance_km: float = Field(..., ge=0.0, le=1000.0)
    features: DonorDispatchFeatures


class RankingRequest(BaseModel):
    candidates: List[RankingCandidate] = Field(..., min_length=1, max_length=500)


class RankedCandidate(BaseModel):
    donor_id: str
    rank: int
    score: float = Field(..., description="Uncalibrated ranking utility, not a probability")


@app.get("/health", status_code=status.HTTP_200_OK, tags=["System"])
def health_check():
    if production_model is None:
        try:
            load_inference_model()
        except RuntimeError:
            return {"status": "degraded", "service": "LIFE-LINK ML Donor Intelligence",
                    "model_loaded": False, "active_model": PRODUCTION_MODEL_NAME,
                    "ranker_available": os.path.isfile(os.getenv("LIFE_LINK_RANKER_MODEL_PATH", os.path.join(ml_dir, "models", "donor_ranker_mlp_v2.joblib"))),
                    "feature_count": len(FEATURE_NAMES), "version": "2.0.0"}
    ranker_path = os.getenv("LIFE_LINK_RANKER_MODEL_PATH", os.path.join(ml_dir, "models", "donor_ranker_mlp_v2.joblib"))
    return {"status": "ok", "service": "LIFE-LINK ML Donor Intelligence",
            "model_loaded": production_model is not None, "active_model": PRODUCTION_MODEL_NAME,
            "ranker_available": os.path.isfile(ranker_path), "ranker_model": RANKER_MODEL_NAME,
            "feature_count": len(FEATURE_NAMES), "version": "2.0.0"}


@app.get("/features", status_code=status.HTTP_200_OK, tags=["System"])
def get_features_schema():
    return {
        "feature_count": len(FEATURE_NAMES), "feature_names": FEATURE_NAMES,
        "target_definition": {"name": "positive_response", "values": {
            "1": "ACCEPTED or COMPLETED dispatch outcome",
            "0": "DECLINED, NO_RESPONSE, MISSED, EXPIRED, CANCELLED"}},
        "excluded_operational_features": ["batch_number", "priorityScore", "status", "respondedAt",
            "acceptedAt", "completedAt", "currentLocation", "eta", "liveLocations"],
        "ranking_v2": {"feature_names": [*FEATURE_NAMES, "distance_km"],
            "score_semantics": "uncalibrated ranking utility; not a probability",
            "training_data_status": "synthetic prototype only pending validation on historical outcomes"},
    }


@app.get("/metadata", status_code=status.HTTP_200_OK, tags=["System"])
def get_metadata():
    return model_metadata


@app.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_200_OK, tags=["V1 Inference"])
def predict_donor_response_endpoint(payload: DonorDispatchFeatures):
    if production_model is None:
        try:
            load_inference_model()
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Production model unavailable") from exc
    try:
        features = payload.model_dump()
        validate_and_order_features(features)
        result = predict_donor_response(features, threshold=MODEL_THRESHOLD)
        return PredictionResponse(prediction=result["prediction"], probability=result["probability"], model=result["model_version"])
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Inference failed") from exc


@app.post("/rank", response_model=List[RankedCandidate], status_code=status.HTTP_200_OK, tags=["V2 Experimental Ranking"])
def rank_donors_endpoint(payload: RankingRequest):
    """Rank caller-authorized candidates; backend must enforce tenant and dispatch authorization."""
    candidates = []
    for candidate in payload.candidates:
        features = candidate.features.model_dump()
        if all(features[key] == 1 for key in ("donor_is_eligible", "donor_is_available", "donor_is_verified", "is_blood_compatible")):
            candidates.append({"donor_id": candidate.donor_id, "distance_km": candidate.distance_km, "features": features})
    if not candidates:
        return []
    try:
        artifact = load_neural_ranker()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Experimental V2 ranker is not installed; V1 remains available") from exc
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Experimental V2 ranker artifact is invalid") from exc
    rows = [{**candidate["features"], "distance_km": candidate["distance_km"]} for candidate in candidates]
    try:
        scored = score_candidates(rows, artifact)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return [RankedCandidate(donor_id=candidates[item["candidate_index"]]["donor_id"], rank=item["rank"], score=item["score"]) for item in scored]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8000)), reload=True)
