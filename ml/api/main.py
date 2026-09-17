"""
LIFE-LINK ML Inference Service (FastAPI)
Production inference API for the frozen Logistic Regression V1 donor-response model.

Medical eligibility is determined upstream by deterministic, verified rules.
This service only produces an advisory donor-response probability for already-eligible candidates.
"""

import json
import os
import sys
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# Add the ML package directory to the import path for direct execution and deployment.
current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
if ml_dir not in sys.path:
    sys.path.insert(0, ml_dir)

from scripts.load_production_model import (  # noqa: E402
    FEATURE_NAMES,
    PRODUCTION_MODEL_NAME,
    load_production_model,
    predict_donor_response,
    validate_and_order_features,
)

MODEL_THRESHOLD = 0.5
production_model: Optional[Any] = None
model_metadata: Dict[str, Any] = {}


def load_inference_model() -> Any:
    """Load the frozen production artifact through the canonical model loader."""
    global production_model, model_metadata

    try:
        production_model = load_production_model()
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        production_model = None
        raise RuntimeError(f"Production model unavailable: {exc}") from exc

    meta_path = os.path.join(ml_dir, "models", "model_metadata.json")
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as metadata_file:
            model_metadata = json.load(metadata_file)

    return production_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_inference_model()
    yield


app = FastAPI(
    title="LIFE-LINK ML Donor Dispatch Response API",
    description=(
        "Production inference endpoint for advisory donor-response scoring. "
        "Medical eligibility is deterministic and enforced upstream."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Browser access is disabled by default. If a controlled browser client is ever required,
# provide a comma-separated allowlist through ML_ALLOWED_ORIGINS.
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("ML_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )


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
            raise ValueError(
                f"donor_positive_responses ({value}) cannot exceed donor_history_count ({history})"
            )
        return value


class PredictionResponse(BaseModel):
    prediction: int = Field(..., description="1 for predicted positive response, otherwise 0")
    probability: float = Field(..., ge=0.0, le=1.0)
    model: str = Field(..., description="Frozen production model version")


@app.get("/health", status_code=status.HTTP_200_OK, tags=["System"])
def health_check():
    if production_model is None:
        try:
            load_inference_model()
        except RuntimeError:
            return {
                "status": "degraded",
                "service": "LIFE-LINK ML Donor Dispatch Prediction Service",
                "model_loaded": False,
                "active_model": PRODUCTION_MODEL_NAME,
                "feature_count": len(FEATURE_NAMES),
                "version": "1.0.0",
            }

    return {
        "status": "ok",
        "service": "LIFE-LINK ML Donor Dispatch Prediction Service",
        "model_loaded": production_model is not None,
        "active_model": PRODUCTION_MODEL_NAME,
        "feature_count": len(FEATURE_NAMES),
        "version": "1.0.0",
    }


@app.get("/features", status_code=status.HTTP_200_OK, tags=["System"])
def get_features_schema():
    return {
        "feature_count": len(FEATURE_NAMES),
        "feature_names": FEATURE_NAMES,
        "target_definition": {
            "name": "positive_response",
            "values": {
                "1": "ACCEPTED or COMPLETED dispatch outcome",
                "0": "DECLINED, NO_RESPONSE, MISSED, EXPIRED, CANCELLED",
            },
        },
        "excluded_operational_features": [
            "batch_number",
            "priorityScore",
            "status",
            "respondedAt",
            "acceptedAt",
            "completedAt",
            "currentLocation",
            "eta",
            "liveLocations",
        ],
    }


@app.get("/metadata", status_code=status.HTTP_200_OK, tags=["System"])
def get_metadata():
    return model_metadata


@app.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_200_OK,
    tags=["Inference"],
)
def predict_donor_response_endpoint(payload: DonorDispatchFeatures):
    if production_model is None:
        try:
            load_inference_model()
        except RuntimeError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Production inference model is unavailable.",
            )

    try:
        features = payload.model_dump()
        # Validate against the canonical production contract before inference.
        validate_and_order_features(features)
        result = predict_donor_response(features, threshold=MODEL_THRESHOLD)
        return PredictionResponse(
            prediction=result["prediction"],
            probability=result["probability"],
            model=result["model_version"],
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Inference failed.",
        ) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
