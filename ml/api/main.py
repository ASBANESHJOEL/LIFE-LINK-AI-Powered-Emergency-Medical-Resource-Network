"""
LIFE-LINK ML Inference Service (FastAPI)
Exposes production-ready prediction endpoint for donor dispatch acceptance.
"""

import os
import sys
import json
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import numpy as np
import pandas as pd
from xgboost import XGBClassifier

from contextlib import asynccontextmanager

# Add parent directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
if ml_dir not in sys.path:
    sys.path.insert(0, ml_dir)

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_inference_model()
    yield

# Initialize FastAPI App
app = FastAPI(
    title="LIFE-LINK ML Donor Dispatch Response API",
    description="Production-ready inference endpoint for predicting emergency blood donor dispatch response.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Expected 18 Features in Exact Training Order
FEATURE_NAMES = [
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

# Pydantic Schema with Strict Validation
class DonorDispatchFeatures(BaseModel):
    is_exact_blood_match: int = Field(..., ge=0, le=1, description="1 if donor blood matches request blood exactly, else 0")
    is_blood_compatible: int = Field(..., ge=0, le=1, description="1 if donor blood is medically compatible with request, else 0")
    is_universal_donor: int = Field(..., ge=0, le=1, description="1 if donor is O-negative, else 0")
    donor_is_verified: int = Field(..., ge=0, le=1, description="1 if donor identity is verified, else 0")
    donor_is_eligible: int = Field(..., ge=0, le=1, description="1 if donor is medically eligible to donate, else 0")
    donor_is_available: int = Field(..., ge=0, le=1, description="1 if donor is marked available at dispatch time, else 0")
    donor_response_rate: float = Field(..., ge=0.0, le=1.0, description="Historical acceptance rate prior to this dispatch (0.0 to 1.0)")
    donor_history_count: int = Field(..., ge=0, description="Total dispatches previously received by donor")
    donor_positive_responses: int = Field(..., ge=0, description="Total positive responses previously given by donor")
    days_since_last_donation: float = Field(..., ge=0.0, description="Days since last blood donation (or 365.0 default)")
    dispatch_hour: int = Field(..., ge=0, le=23, description="Hour of dispatch (0-23)")
    dispatch_day_of_week: int = Field(..., ge=0, le=6, description="Day of week (0=Monday, 6=Sunday)")
    is_weekend: int = Field(..., ge=0, le=1, description="1 if dispatch is on Saturday or Sunday, else 0")
    is_night_dispatch: int = Field(..., ge=0, le=1, description="1 if dispatched between 22:00 and 06:00, else 0")
    is_business_hours: int = Field(..., ge=0, le=1, description="1 if dispatched during business hours (09:00-18:00 Mon-Fri), else 0")
    requested_quantity: float = Field(..., gt=0.0, description="Blood units requested in emergency")
    urgency_level: int = Field(..., ge=0, le=3, description="Urgency: 3 (Critical), 2 (High), 1 (Medium), 0 (Low)")
    is_resource_blood: int = Field(..., ge=0, le=1, description="1 if resource is whole blood / RBC, else 0")

    @field_validator("donor_positive_responses")
    @classmethod
    def validate_positive_le_history(cls, v, info):
        history = info.data.get("donor_history_count")
        if history is not None and v > history:
            raise ValueError(f"donor_positive_responses ({v}) cannot exceed donor_history_count ({history})")
        return v

    model_config = {
        "json_schema_extra": {
            "example": {
                "is_exact_blood_match": 1,
                "is_blood_compatible": 1,
                "is_universal_donor": 0,
                "donor_is_verified": 1,
                "donor_is_eligible": 1,
                "donor_is_available": 1,
                "donor_response_rate": 0.72,
                "donor_history_count": 10,
                "donor_positive_responses": 7,
                "days_since_last_donation": 120.0,
                "dispatch_hour": 14,
                "dispatch_day_of_week": 2,
                "is_weekend": 0,
                "is_night_dispatch": 0,
                "is_business_hours": 1,
                "requested_quantity": 2.0,
                "urgency_level": 3,
                "is_resource_blood": 1
            }
        }
    }


class PredictionResponse(BaseModel):
    prediction: int = Field(..., description="1 for predicted acceptance, 0 for predicted non-response/decline")
    probability: float = Field(..., description="Predicted probability of positive donor response [0.0 - 1.0]")
    model: str = Field(..., description="Identifier of the model used for inference")


# Global Model Holder
production_model: Optional[Any] = None
model_metadata: Dict[str, Any] = {}
loaded_model_type: str = "donor_response_logistic_v1"


def load_inference_model():
    global production_model, model_metadata, loaded_model_type
    
    models_dir = os.path.join(ml_dir, "models")
    meta_path = os.path.join(models_dir, "model_metadata.json")
    prod_joblib_file = os.path.join(models_dir, "donor_response_logistic_v1.joblib")

    if os.path.exists(meta_path):
        with open(meta_path, "r") as f:
            model_metadata = json.load(f)

    # 1. Prefer Production Logistic Regression V1 Joblib artifact
    if os.path.exists(prod_joblib_file):
        import joblib
        print(f"[API] Loading production V1 model from: {prod_joblib_file}")
        production_model = joblib.load(prod_joblib_file)
        loaded_model_type = model_metadata.get("production_model_marker", "donor_response_logistic_v1")
        print(f"[API] Successfully loaded {loaded_model_type} into memory.")
        return

    # 2. Fallback to XGBoost research model if joblib is absent
    selected_key = model_metadata.get("selected_model", "xgb_baseline")
    model_file = os.path.join(models_dir, f"donor_response_{selected_key}.json")
    if not os.path.exists(model_file):
        model_file = os.path.join(models_dir, "donor_response_xgb_baseline.json")

    if not os.path.exists(model_file):
        print(f"[API] Warning: Model artifacts not found. Running training pipeline...")
        from scripts.train_production import train_and_package_production_model
        train_and_package_production_model()
        return load_inference_model()

    print(f"[API] Fallback loading model from: {model_file}")
    model = XGBClassifier()
    model.load_model(model_file)
    production_model = model
    loaded_model_type = selected_key
    print(f"[API] Successfully loaded {loaded_model_type} into memory.")


@app.get("/health", status_code=status.HTTP_200_OK, tags=["System"])
def health_check():
    if production_model is None:
        load_inference_model()
    return {
        "status": "ok",
        "service": "LIFE-LINK ML Donor Dispatch Prediction Service",
        "model_loaded": production_model is not None,
        "active_model": loaded_model_type,
        "feature_count": len(FEATURE_NAMES),
        "version": "1.0.0"
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
                "0": "DECLINED, NO_RESPONSE, MISSED, EXPIRED, CANCELLED"
            }
        }
    }


@app.get("/metadata", status_code=status.HTTP_200_OK, tags=["System"])
def get_metadata():
    if not model_metadata:
        meta_path = os.path.join(ml_dir, "models", "model_metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                return json.load(f)
    return model_metadata


@app.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_200_OK, tags=["Inference"])
def predict_donor_response(payload: DonorDispatchFeatures):
    if production_model is None:
        load_inference_model()
        if production_model is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Inference model is not loaded."
            )

    try:
        # Extract features in the EXACT ordered sequence
        feature_dict = payload.model_dump()
        feature_vector = [feature_dict[feat] for feat in FEATURE_NAMES]

        # Convert to 2D numpy array with column names matching XGBoost booster
        df_input = pd.DataFrame([feature_vector], columns=FEATURE_NAMES)

        # Inference
        probability = float(production_model.predict_proba(df_input)[0, 1])
        prediction = int(probability >= 0.5)

        return PredictionResponse(
            prediction=prediction,
            probability=round(probability, 4),
            model=loaded_model_type
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=True)
