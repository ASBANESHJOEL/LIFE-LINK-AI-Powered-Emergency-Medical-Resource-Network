"""Experimental MLP ranking model. Synthetic prototype only; scores are not probabilities."""
import math
import os
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from scripts.load_production_model import FEATURE_NAMES

RANKER_MODEL_NAME = "donor_ranker_mlp_v2"
RANKING_FEATURE_NAMES = [*FEATURE_NAMES, "distance_km"]
DEFAULT_RANKER_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "donor_ranker_mlp_v2.joblib")


def validate_ranking_features(features: Mapping[str, Any]) -> dict[str, float]:
    expected, actual = set(RANKING_FEATURE_NAMES), set(features)
    missing, extra = expected - actual, actual - expected
    if missing or extra:
        raise ValueError(f"Ranking feature mismatch; missing={sorted(missing)}, unexpected={sorted(extra)}")
    result = {}
    for name in RANKING_FEATURE_NAMES:
        value = features[name]
        if value is None:
            raise ValueError(f"Ranking feature '{name}' cannot be null")
        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Ranking feature '{name}' must be numeric") from exc
        if not math.isfinite(numeric):
            raise ValueError(f"Ranking feature '{name}' must be finite")
        result[name] = numeric
    if result["distance_km"] < 0:
        raise ValueError("distance_km cannot be negative")
    if not 0 <= result["donor_response_rate"] <= 1:
        raise ValueError("donor_response_rate must be between 0 and 1")
    if result["donor_positive_responses"] > result["donor_history_count"]:
        raise ValueError("positive responses cannot exceed dispatch history")
    return result


def synthetic_teacher_utility(row: Mapping[str, Any]) -> float:
    """Invented teaching rule used to validate the synthetic ranking pipeline only."""
    history = max(0.0, float(row["donor_history_count"]))
    distance = max(0.0, float(row["distance_km"]))
    return (
        0.42 * float(row["donor_response_rate"])
        + 0.14 * min(math.log1p(history) / math.log(51), 1.0)
        + 0.27 * math.exp(-distance / 12.0)
        + 0.07 * float(row["is_business_hours"])
        + 0.06 * float(row["urgency_level"]) / 3.0
        + 0.04 * float(row["is_exact_blood_match"])
    )


def build_ranker_pipeline(random_state: int = 42) -> Pipeline:
    return Pipeline([
        ("scaler", StandardScaler()),
        ("mlp", MLPRegressor(hidden_layer_sizes=(64, 32), activation="relu", solver="adam",
                             alpha=0.002, learning_rate_init=0.001, max_iter=350,
                             early_stopping=False, random_state=random_state)),
    ])


def load_neural_ranker(model_path: str | None = None) -> dict[str, Any]:
    path = model_path or os.getenv("LIFE_LINK_RANKER_MODEL_PATH") or DEFAULT_RANKER_PATH
    if not os.path.isfile(path):
        raise FileNotFoundError(f"V2 ranker artifact not found at {path}; train it with ml/scripts/train_neural_ranker.py")
    artifact = joblib.load(path)
    if not isinstance(artifact, dict) or not hasattr(artifact.get("model"), "predict"):
        raise ValueError("Invalid V2 ranker artifact format")
    if artifact.get("model_version") != RANKER_MODEL_NAME:
        raise ValueError("Unexpected V2 ranker model version")
    if artifact.get("feature_names") != RANKING_FEATURE_NAMES:
        raise ValueError("V2 ranker feature schema mismatch")
    return artifact


def score_candidates(candidates: Sequence[Mapping[str, Any]], artifact: Mapping[str, Any]) -> list[dict[str, Any]]:
    validated = [validate_ranking_features(item) for item in candidates]
    if not validated:
        return []
    frame = pd.DataFrame(validated, columns=RANKING_FEATURE_NAMES)
    scores = np.asarray(artifact["model"].predict(frame), dtype=float)
    if len(scores) != len(validated) or not np.isfinite(scores).all():
        raise ValueError("Ranker produced invalid scores")
    order = sorted(range(len(scores)), key=lambda i: (-float(scores[i]), i))
    return [{"candidate_index": i, "score": round(float(scores[i]), 6), "rank": rank}
            for rank, i in enumerate(order, start=1)]
