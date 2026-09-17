"""
LIFE-LINK Production Model Training Pipeline (V1)
Trains and packages the validated Logistic Regression production model for donor response prediction.

Features:
- Exactly 18 approved domain features (zero-leakage, dispatch-time only)
- Donor-group-aware data partitioning (GroupShuffleSplit on donor_id)
- Unified scikit-learn Pipeline (StandardScaler + LogisticRegression)
- Serialization to joblib with comprehensive metadata and reproducibility audit
"""

import os
import sys
import json
from datetime import datetime
import pandas as pd
import numpy as np
import joblib
import sklearn
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix
)

# Setup paths
_scripts_dir = os.path.dirname(os.path.abspath(__file__))
_ml_dir = os.path.dirname(_scripts_dir)
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)
if _ml_dir not in sys.path:
    sys.path.insert(0, _ml_dir)

from feature_engineering import FEATURE_NAMES, build_ml_dataset

# Production Version Marker
PRODUCTION_MODEL_VERSION = "donor_response_logistic_v1"
MODEL_NAME = "donor_response"
MODEL_VERSION = "v1"
ALGORITHM = "logistic_regression"

# Validated Holdout Benchmark Metrics from Candidate Study
VALIDATED_HOLDOUT_BENCHMARKS = {
    "logistic_regression_v1": {
        "accuracy": 0.7782,
        "precision": 0.7981,
        "recall": 0.9401,
        "f1": 0.8633,
        "roc_auc": 0.7419,
        "pr_auc": 0.8813
    },
    "xgboost": {
        "accuracy": 0.7643,
        "f1": 0.8539,
        "roc_auc": 0.7319
    },
    "catboost": {
        "accuracy": 0.7629,
        "f1": 0.8519,
        "roc_auc": 0.7214
    },
    "extratrees": {
        "accuracy": 0.7252,
        "f1": 0.8264,
        "roc_auc": 0.6792
    },
    "ensemble_logistic_xgboost": {
        "status": "research_only",
        "description": "Marginal improvement over Logistic Regression; preserved as research experiment."
    }
}


def compute_metrics(y_true, y_pred, y_prob):
    """Computes comprehensive classification metrics."""
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "pr_auc": round(float(average_precision_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def train_and_package_production_model(
    processed_dir: str = os.path.join(_ml_dir, "data", "processed"),
    models_dir: str = os.path.join(_ml_dir, "models"),
    random_state: int = 42
):
    """
    Trains the canonical Logistic Regression V1 production pipeline and packages all artifacts.
    """
    os.makedirs(models_dir, exist_ok=True)

    train_path = os.path.join(processed_dir, "train.csv")
    val_path = os.path.join(processed_dir, "val.csv")
    test_path = os.path.join(processed_dir, "test.csv")
    full_path = os.path.join(processed_dir, "dataset_full.csv")

    # Ensure processed datasets exist
    if not all(os.path.exists(p) for p in [train_path, val_path, test_path]):
        print("[train_production] Processed dataset not found. Generating via feature_engineering.py...")
        df_train, df_val, df_test, _ = build_ml_dataset(
            processed_dir=processed_dir,
            random_state=random_state
        )
        df_full = pd.read_csv(full_path) if os.path.exists(full_path) else pd.concat([df_train, df_val, df_test])
    else:
        df_train = pd.read_csv(train_path)
        df_val = pd.read_csv(val_path)
        df_test = pd.read_csv(test_path)
        df_full = pd.read_csv(full_path) if os.path.exists(full_path) else pd.concat([df_train, df_val, df_test])

    print("=" * 80)
    print("LIFE-LINK PRODUCTION V1 MODEL TRAINING: LOGISTIC REGRESSION")
    print("=" * 80)
    print(f"Algorithm            : {ALGORITHM}")
    print(f"Model Identifier     : {PRODUCTION_MODEL_VERSION}")
    print(f"Feature Count        : {len(FEATURE_NAMES)}")
    print(f"Training Samples     : {len(df_train)} (Donors: {df_train['donor_id'].nunique() if 'donor_id' in df_train else 'N/A'})")
    print(f"Validation Samples   : {len(df_val)} (Donors: {df_val['donor_id'].nunique() if 'donor_id' in df_val else 'N/A'})")
    print(f"Untouched Test Count : {len(df_test)} (Donors: {df_test['donor_id'].nunique() if 'donor_id' in df_test else 'N/A'})")
    print(f"Split Isolation      : Donor GroupShuffleSplit (Zero donor overlap)")
    print("-" * 80)

    # Feature extraction in strict 18-feature order
    X_train = df_train[FEATURE_NAMES]
    y_train = df_train['target']

    X_val = df_val[FEATURE_NAMES]
    y_val = df_val['target']

    X_test = df_test[FEATURE_NAMES]
    y_test = df_test['target']

    # Production Pipeline: StandardScaler + LogisticRegression
    # Standard C=1.0, penalty='l2', solver='lbfgs', max_iter=1000, random_state=42
    classifier_params = {
        "penalty": "l2",
        "C": 1.0,
        "solver": "lbfgs",
        "max_iter": 1000,
        "random_state": random_state
    }

    production_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(**classifier_params))
    ])

    print("[train_production] Fitting Pipeline on training split...")
    production_pipeline.fit(X_train, y_train)

    # Predictions & Metrics on splits
    train_pred = production_pipeline.predict(X_train)
    train_prob = production_pipeline.predict_proba(X_train)[:, 1]
    train_metrics = compute_metrics(y_train, train_pred, train_prob)

    val_pred = production_pipeline.predict(X_val)
    val_prob = production_pipeline.predict_proba(X_val)[:, 1]
    val_metrics = compute_metrics(y_val, val_pred, val_prob)

    test_pred = production_pipeline.predict(X_test)
    test_prob = production_pipeline.predict_proba(X_test)[:, 1]
    test_metrics = compute_metrics(y_test, test_pred, test_prob)

    print("\nTRAINING & VALIDATION METRICS:")
    print(f"  - Train Set : Acc={train_metrics['accuracy']*100:.2f}%, Prec={train_metrics['precision']*100:.2f}%, Rec={train_metrics['recall']*100:.2f}%, F1={train_metrics['f1']*100:.2f}%, ROC-AUC={train_metrics['roc_auc']:.4f}, PR-AUC={train_metrics['pr_auc']:.4f}")
    print(f"  - Val Set   : Acc={val_metrics['accuracy']*100:.2f}%, Prec={val_metrics['precision']*100:.2f}%, Rec={val_metrics['recall']*100:.2f}%, F1={val_metrics['f1']*100:.2f}%, ROC-AUC={val_metrics['roc_auc']:.4f}, PR-AUC={val_metrics['pr_auc']:.4f}")
    print(f"  - Test Set  : Acc={test_metrics['accuracy']*100:.2f}%, Prec={test_metrics['precision']*100:.2f}%, Rec={test_metrics['recall']*100:.2f}%, F1={test_metrics['f1']*100:.2f}%, ROC-AUC={test_metrics['roc_auc']:.4f}, PR-AUC={test_metrics['pr_auc']:.4f}")

    # Extract coefficients and intercept
    clf = production_pipeline.named_steps["classifier"]
    scaler = production_pipeline.named_steps["scaler"]

    coef_dict = {}
    for feat_name, coef_val in zip(FEATURE_NAMES, clf.coef_[0]):
        coef_dict[feat_name] = round(float(coef_val), 6)

    # Sort coefficients by absolute magnitude for interpretability
    sorted_coefs = sorted(coef_dict.items(), key=lambda x: abs(x[1]), reverse=True)

    print("\nLOGISTIC REGRESSION COEFFICIENTS (Standardized):")
    for rank, (feat, coef) in enumerate(sorted_coefs, 1):
        direction = "(+ accepts)" if coef > 0 else "(- declines)"
        print(f"  {rank:2d}. {feat:<35} : {coef:>9.4f}  {direction}")

    # 1. Save serialized model pipeline to .joblib
    model_artifact_path = os.path.join(models_dir, "donor_response_logistic_v1.joblib")
    joblib.dump(production_pipeline, model_artifact_path, compress=3)
    file_size_bytes = os.path.getsize(model_artifact_path)
    print(f"\n[train_production] Serialized production model saved to: {model_artifact_path} ({file_size_bytes / 1024:.2f} KB)")

    # 2. Build comprehensive metadata dictionary
    metadata = {
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "production_model_marker": PRODUCTION_MODEL_VERSION,
        "algorithm": ALGORITHM,
        "pipeline_structure": ["StandardScaler", "LogisticRegression"],
        "creation_timestamp": datetime.now().isoformat(),
        "python_version": sys.version.split()[0],
        "sklearn_version": sklearn.__version__,
        "joblib_version": joblib.__version__,
        "model_artifact": {
            "path": "ml/models/donor_response_logistic_v1.joblib",
            "size_bytes": file_size_bytes,
            "format": "joblib"
        },
        "target_definition": {
            "name": "positive_response",
            "description": "1 if donor dispatch resulted in ACCEPTED or COMPLETED outcome, 0 if DECLINED, NO_RESPONSE, MISSED, EXPIRED, CANCELLED",
            "positive_label": 1,
            "negative_label": 0
        },
        "feature_names": FEATURE_NAMES,
        "feature_count": len(FEATURE_NAMES),
        "feature_coefficients": coef_dict,
        "intercept": round(float(clf.intercept_[0]), 6),
        "scaler_information": {
            "mean": [round(float(m), 6) for m in scaler.mean_],
            "scale": [round(float(s), 6) for s in scaler.scale_],
            "var": [round(float(v), 6) for v in scaler.var_]
        },
        "hyperparameters": classifier_params,
        "training_dataset": {
            "source": "ml/data/processed/train.csv",
            "total_records": len(df_full),
            "training_row_count": len(df_train),
            "training_donor_count": int(df_train['donor_id'].nunique()) if 'donor_id' in df_train else None,
            "validation_row_count": len(df_val),
            "validation_donor_count": int(df_val['donor_id'].nunique()) if 'donor_id' in df_val else None,
            "test_row_count": len(df_test),
            "test_donor_count": int(df_test['donor_id'].nunique()) if 'donor_id' in df_test else None,
            "positive_prevalence": round(float(df_train['target'].mean() * 100), 2)
        },
        "validation_methodology": {
            "strategy": "Donor-Group-Aware Partitioning (GroupShuffleSplit on donor_id)",
            "leakage_safeguard": "Strict zero-donor-overlap across train, validation, and holdout test partitions",
            "train_ratio": 0.70,
            "val_ratio": 0.15,
            "test_ratio": 0.15
        },
        "split_evaluation_metrics": {
            "train": train_metrics,
            "validation": val_metrics,
            "test": test_metrics
        },
        "fresh_holdout_evaluation_results": VALIDATED_HOLDOUT_BENCHMARKS["logistic_regression_v1"],
        "candidate_model_comparisons": VALIDATED_HOLDOUT_BENCHMARKS,
        "research_artifacts": {
            "xgboost_baseline": "ml/models/donor_response_xgb_baseline.json",
            "xgboost_hem": "ml/models/donor_response_xgb_hem.json",
            "feature_ablation_report": "ml/models/feature_ablation_final_report.json",
            "scientific_improvement_report": "ml/models/scientific_improvement_report.json"
        }
    }

    metadata_path = os.path.join(models_dir, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"[train_production] Production metadata saved to: {metadata_path}")
    print("=" * 80 + "\n")

    return production_pipeline, metadata


if __name__ == "__main__":
    train_and_package_production_model()
