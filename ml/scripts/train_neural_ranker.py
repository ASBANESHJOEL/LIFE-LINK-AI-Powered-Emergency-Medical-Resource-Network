"""Train V2 on reproducible synthetic scenarios; metrics are not real-world evidence."""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

ML_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)
from scripts.load_production_model import FEATURE_NAMES
from scripts.neural_ranker import DEFAULT_RANKER_PATH, RANKER_MODEL_NAME, RANKING_FEATURE_NAMES, build_ranker_pipeline, synthetic_teacher_utility


def generate_synthetic_scenarios(scenario_count=1200, candidates_per_scenario=8, seed=42):
    rng = np.random.default_rng(seed)
    rows = []
    for scenario_id in range(scenario_count):
        hour, day = int(rng.integers(0, 24)), int(rng.integers(0, 7))
        urgency, quantity = int(rng.integers(0, 4)), float(rng.integers(1, 7))
        for _ in range(candidates_per_scenario):
            history = int(rng.integers(0, 40))
            positives = int(rng.integers(0, history + 1))
            row = {
                "is_exact_blood_match": int(rng.random() < .55), "is_blood_compatible": 1,
                "is_universal_donor": int(rng.random() < .12), "donor_is_verified": 1,
                "donor_is_eligible": 1, "donor_is_available": 1,
                "donor_response_rate": (positives + 2.0) / (history + 4.0),
                "donor_history_count": history, "donor_positive_responses": positives,
                "days_since_last_donation": float(rng.integers(60, 500)),
                "dispatch_hour": hour, "dispatch_day_of_week": day, "is_weekend": int(day >= 5),
                "is_night_dispatch": int(hour >= 22 or hour < 6),
                "is_business_hours": int(day < 5 and 9 <= hour < 18),
                "requested_quantity": quantity, "urgency_level": urgency, "is_resource_blood": 1,
                "distance_km": float(np.clip(rng.gamma(2.0, 4.0), 0, 60)),
                "scenario_id": scenario_id,
            }
            row["target_utility"] = synthetic_teacher_utility(row) + float(rng.normal(0, .025))
            rows.append(row)
    return pd.DataFrame(rows)


def split_by_scenario(df, seed=42):
    groups = df["scenario_id"].to_numpy()
    train_idx, hold_idx = next(GroupShuffleSplit(n_splits=1, test_size=.30, random_state=seed).split(df, groups=groups))
    hold = df.iloc[hold_idx]
    val_rel, test_rel = next(GroupShuffleSplit(n_splits=1, test_size=.50, random_state=seed + 1).split(hold, groups=hold["scenario_id"].to_numpy()))
    return df.iloc[train_idx].copy(), hold.iloc[val_rel].copy(), hold.iloc[test_rel].copy()


def ndcg_at_k(y_true, y_score, k=5):
    y_true, y_score = np.asarray(y_true), np.asarray(y_score)
    order, ideal = np.argsort(-y_score)[:k], np.argsort(-y_true)[:k]
    gains, ideal_gains = np.power(2.0, y_true[order]) - 1, np.power(2.0, y_true[ideal]) - 1
    discounts = np.log2(np.arange(2, len(order) + 2))
    denom = float(np.sum(ideal_gains / discounts))
    return float(np.sum(gains / discounts) / denom) if denom else 0.0


def grouped_ndcg(df, predictions, k=5):
    view = df[["scenario_id", "target_utility"]].copy()
    view["score"] = predictions
    scores = [ndcg_at_k(g["target_utility"], g["score"], k) for _, g in view.groupby("scenario_id")]
    return float(np.mean(scores)) if scores else 0.0


def train(output_path=DEFAULT_RANKER_PATH, seed=42):
    data = generate_synthetic_scenarios(seed=seed)
    train_df, val_df, test_df = split_by_scenario(data, seed=seed)
    model = build_ranker_pipeline(random_state=seed)
    model.fit(train_df[RANKING_FEATURE_NAMES], train_df["target_utility"])
    val_scores = model.predict(val_df[RANKING_FEATURE_NAMES])
    test_scores = model.predict(test_df[RANKING_FEATURE_NAMES])
    metadata = {
        "model_version": RANKER_MODEL_NAME, "algorithm": "MLPRegressor(64,32)+StandardScaler",
        "trained_at_utc": datetime.now(timezone.utc).isoformat(), "seed": seed,
        "dataset": "synthetic_only", "scenario_count": int(data.scenario_id.nunique()),
        "candidate_count": int(len(data)), "feature_names": RANKING_FEATURE_NAMES,
        "split_scenarios": {"train": int(train_df.scenario_id.nunique()),
                            "validation": int(val_df.scenario_id.nunique()),
                            "test": int(test_df.scenario_id.nunique())},
        "validation_ndcg_at_5": round(grouped_ndcg(val_df, val_scores), 4),
        "test_ndcg_at_5": round(grouped_ndcg(test_df, test_scores), 4),
        "limitation": "Synthetic pipeline validation only; not evidence of real donor behavior or superiority over V1.",
    }
    artifact = {"model_version": RANKER_MODEL_NAME, "feature_names": RANKING_FEATURE_NAMES,
                "model": model, "metadata": metadata}
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    joblib.dump(artifact, output_path)
    metadata_path = os.path.splitext(output_path)[0] + ".metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    print(json.dumps(metadata, indent=2))
    print(f"Saved experimental ranker: {output_path}")
    print(f"Saved metadata: {metadata_path}")
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=DEFAULT_RANKER_PATH)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    train(args.output, args.seed)
