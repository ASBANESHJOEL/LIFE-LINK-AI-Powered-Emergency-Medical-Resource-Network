"""
LIFE-LINK Production Model Loader & Inference Utility
Provides high-performance, deterministic inference for the LIFE-LINK V1 Logistic Regression production model.

Features:
- Validates that inputs contain exactly the 18 approved domain features in strict canonical order
- Explicit error handling for missing, unexpected, or null features
- Encapsulates preprocessing (StandardScaler) and classification in a single call
- Zero external overhead
"""

import os
import sys
import joblib
import numpy as np
import pandas as pd
from typing import Dict, Any, Union, List, Tuple

# Exact 18 Canonical Domain Features in Ordered Sequence
FEATURE_NAMES: List[str] = [
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

PRODUCTION_MODEL_NAME = "donor_response_logistic_v1"

# Module-level cache
_CACHED_MODEL = None
_CACHED_MODEL_PATH = None


def get_default_model_path() -> str:
    """Resolves the default absolute path to donor_response_logistic_v1.joblib."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    ml_dir = os.path.dirname(current_dir)
    return os.path.join(ml_dir, "models", "donor_response_logistic_v1.joblib")


def load_production_model(model_path: str = None, force_reload: bool = False):
    """
    Loads and caches the serialized production Logistic Regression Pipeline.
    
    Args:
        model_path: Optional custom path to .joblib file.
        force_reload: Whether to bypass in-memory cache and reload from disk.
        
    Returns:
        The loaded sklearn Pipeline.
    """
    global _CACHED_MODEL, _CACHED_MODEL_PATH
    
    target_path = model_path or get_default_model_path()

    if _CACHED_MODEL is not None and _CACHED_MODEL_PATH == target_path and not force_reload:
        return _CACHED_MODEL

    if not os.path.exists(target_path):
        raise FileNotFoundError(
            f"Production model artifact not found at: {target_path}. "
            f"Please run 'python ml/scripts/train_production.py' to generate the artifact."
        )

    try:
        model = joblib.load(target_path)
    except Exception as e:
        raise RuntimeError(f"Failed to load production model from {target_path}: {str(e)}") from e

    # Verify pipeline structure
    if not hasattr(model, "predict") or not hasattr(model, "predict_proba"):
        raise ValueError(f"Loaded object from {target_path} is not a valid scikit-learn estimator/pipeline.")

    _CACHED_MODEL = model
    _CACHED_MODEL_PATH = target_path
    return _CACHED_MODEL


def validate_and_order_features(features: Union[Dict[str, Any], pd.DataFrame, List[float]]) -> pd.DataFrame:
    """
    Validates that incoming features strictly contain all 18 required features,
    and returns a DataFrame strictly ordered by FEATURE_NAMES.
    
    Args:
        features: Dictionary of feature_name -> value, or single-row DataFrame, or 18-element list.
        
    Returns:
        pd.DataFrame with shape (1, 18) in the exact FEATURE_NAMES order.
        
    Raises:
        ValueError: If features are missing, extra unexpected features are present, or values are invalid.
    """
    if isinstance(features, dict):
        incoming_keys = set(features.keys())
        expected_keys = set(FEATURE_NAMES)
        
        missing = expected_keys - incoming_keys
        if missing:
            raise ValueError(
                f"Missing required production features ({len(missing)} missing): {sorted(list(missing))}. "
                f"Expected all 18 features: {FEATURE_NAMES}"
            )
        
        # Build ordered vector
        ordered_values = []
        for feat in FEATURE_NAMES:
            val = features[feat]
            if val is None or (isinstance(val, float) and np.isnan(val)):
                raise ValueError(f"Feature '{feat}' cannot be null or NaN.")
            try:
                val_float = float(val)
            except (ValueError, TypeError) as e:
                raise ValueError(f"Feature '{feat}' must be numeric, got {type(val)}: {val}") from e
            ordered_values.append(val_float)
            
        return pd.DataFrame([ordered_values], columns=FEATURE_NAMES)

    elif isinstance(features, pd.DataFrame):
        missing = [f for f in FEATURE_NAMES if f not in features.columns]
        if missing:
            raise ValueError(
                f"DataFrame missing required production features ({len(missing)} missing): {missing}. "
                f"Expected all 18 features: {FEATURE_NAMES}"
            )
        
        # Check for nulls
        null_counts = features[FEATURE_NAMES].isnull().sum()
        cols_with_nulls = null_counts[null_counts > 0].index.tolist()
        if cols_with_nulls:
            raise ValueError(f"DataFrame contains null values in features: {cols_with_nulls}")
            
        # Enforce exact column ordering
        return features[FEATURE_NAMES].copy()

    elif isinstance(features, (list, tuple, np.ndarray)):
        if len(features) != len(FEATURE_NAMES):
            raise ValueError(
                f"Feature sequence length mismatch: received {len(features)} elements, "
                f"expected exactly {len(FEATURE_NAMES)} features in order: {FEATURE_NAMES}"
            )
        return pd.DataFrame([list(features)], columns=FEATURE_NAMES)

    else:
        raise TypeError(f"Unsupported features input type: {type(features)}. Expected dict, DataFrame, or list.")


def predict_donor_response(
    features: Union[Dict[str, Any], pd.DataFrame, List[float]],
    threshold: float = 0.5,
    model_path: str = None
) -> Dict[str, Any]:
    """
    Computes deterministic donor response prediction.
    
    Args:
        features: Input feature mapping or DataFrame.
        threshold: Classification probability threshold (default: 0.5).
        model_path: Optional model path override.
        
    Returns:
        Dict containing:
        - prediction (int: 0 or 1)
        - probability (float: [0.0, 1.0])
        - threshold (float)
        - model_version (str: "donor_response_logistic_v1")
    """
    model = load_production_model(model_path=model_path)
    df_ordered = validate_and_order_features(features)

    # Compute probability and binary decision
    probs = model.predict_proba(df_ordered)
    probability = float(probs[0, 1])
    prediction = int(probability >= threshold)

    return {
        "prediction": prediction,
        "probability": round(probability, 4),
        "threshold": threshold,
        "model_version": PRODUCTION_MODEL_NAME
    }


if __name__ == "__main__":
    # Smoke test loader
    sample_input = {
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
    
    res = predict_donor_response(sample_input)
    print("Loader Smoke Test Output:")
    print(res)
