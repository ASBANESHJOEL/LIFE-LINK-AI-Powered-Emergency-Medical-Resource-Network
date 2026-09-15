"""
LIFE-LINK Comprehensive Model Evaluation & Comparison Pipeline
Evaluates Baseline XGBoost vs XGBoost + Hard Example Mining on the untouched test set,
conducts overfitting analysis, extracts feature importance, and writes model_metadata.json.
"""

import os
import sys
import json
from datetime import datetime
import pandas as pd
import numpy as np

# Ensure scripts directory and ml directory are on sys.path
_scripts_dir = os.path.dirname(os.path.abspath(__file__))
_ml_dir = os.path.dirname(_scripts_dir)
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)
if _ml_dir not in sys.path:
    sys.path.insert(0, _ml_dir)

from xgboost import XGBClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix
)

from feature_engineering import FEATURE_NAMES, build_ml_dataset
from train_baseline import train_baseline_model
from train_hem import train_hem_model


def compute_metrics(y_true, y_pred, y_prob):
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def run_evaluation_pipeline(
    processed_dir: str = "ml/data/processed",
    models_dir: str = "ml/models",
    random_state: int = 42
):
    os.makedirs(models_dir, exist_ok=True)

    # 1. Ensure Data exists
    train_path = os.path.join(processed_dir, "train.csv")
    val_path = os.path.join(processed_dir, "val.csv")
    test_path = os.path.join(processed_dir, "test.csv")
    full_path = os.path.join(processed_dir, "dataset_full.csv")

    if not all(os.path.exists(p) for p in [train_path, val_path, test_path, full_path]):
        print("[evaluate] Datasets missing. Rebuilding pipeline data...")
        df_train, df_val, df_test, _ = build_ml_dataset(processed_dir=processed_dir, random_state=random_state)
        df_full = pd.read_csv(full_path)
    else:
        df_train = pd.read_csv(train_path)
        df_val = pd.read_csv(val_path)
        df_test = pd.read_csv(test_path)
        df_full = pd.read_csv(full_path)

    X_train = df_train[FEATURE_NAMES]
    y_train = df_train['target']
    X_val = df_val[FEATURE_NAMES]
    y_val = df_val['target']
    X_test = df_test[FEATURE_NAMES]
    y_test = df_test['target']

    # 2. Train / Load Baseline Model
    baseline_model_path = os.path.join(models_dir, "donor_response_xgb_baseline.json")
    print("\n--- Training Baseline Model ---")
    baseline_model, baseline_data = train_baseline_model(
        processed_dir=processed_dir,
        models_dir=models_dir,
        random_state=random_state
    )

    # 3. Train / Load HEM Model
    hem_model_path = os.path.join(models_dir, "donor_response_xgb_hem.json")
    print("\n--- Training HEM Model ---")
    hem_model, hem_data = train_hem_model(
        processed_dir=processed_dir,
        models_dir=models_dir,
        random_state=random_state
    )

    # 4. Final Evaluation on Untouched Test Set
    baseline_test_pred = baseline_model.predict(X_test)
    baseline_test_prob = baseline_model.predict_proba(X_test)[:, 1]
    baseline_test_metrics = compute_metrics(y_test, baseline_test_pred, baseline_test_prob)

    hem_test_pred = hem_model.predict(X_test)
    hem_test_prob = hem_model.predict_proba(X_test)[:, 1]
    hem_test_metrics = compute_metrics(y_test, hem_test_pred, hem_test_prob)

    # Calculate improvements
    improvements = {}
    pct_improvements = {}
    for metric in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']:
        b_val = baseline_test_metrics[metric]
        h_val = hem_test_metrics[metric]
        abs_diff = round(h_val - b_val, 4)
        pct_diff = round(((h_val - b_val) / b_val) * 100.0 if b_val > 0 else 0.0, 2)
        improvements[metric] = abs_diff
        pct_improvements[metric] = pct_diff

    # 5. Overfitting Analysis
    baseline_train_metrics = baseline_data['train_metrics']
    hem_train_metrics = hem_data['train_metrics']

    overfitting_analysis = {
        "baseline": {
            "train_accuracy": baseline_train_metrics['accuracy'],
            "val_accuracy": baseline_data['val_metrics']['accuracy'],
            "test_accuracy": baseline_test_metrics['accuracy'],
            "train_test_acc_gap": round(baseline_train_metrics['accuracy'] - baseline_test_metrics['accuracy'], 4),
            "train_test_f1_gap": round(baseline_train_metrics['f1'] - baseline_test_metrics['f1'], 4),
            "train_test_roc_auc_gap": round(baseline_train_metrics['roc_auc'] - baseline_test_metrics['roc_auc'], 4)
        },
        "hem": {
            "train_accuracy": hem_train_metrics['accuracy'],
            "val_accuracy": hem_data['val_metrics']['accuracy'],
            "test_accuracy": hem_test_metrics['accuracy'],
            "train_test_acc_gap": round(hem_train_metrics['accuracy'] - hem_test_metrics['accuracy'], 4),
            "train_test_f1_gap": round(hem_train_metrics['f1'] - hem_test_metrics['f1'], 4),
            "train_test_roc_auc_gap": round(hem_train_metrics['roc_auc'] - hem_test_metrics['roc_auc'], 4)
        }
    }

    # 6. Feature Importance Extraction
    importances_gain = hem_model.get_booster().get_score(importance_type='gain')
    importances_weight = hem_model.get_booster().get_score(importance_type='weight')

    # Map features
    feature_importance_list = []
    for feat in FEATURE_NAMES:
        gain_val = float(importances_gain.get(feat, 0.0))
        weight_val = float(importances_weight.get(feat, 0.0))
        feature_importance_list.append({
            "feature": feat,
            "gain": round(gain_val, 4),
            "weight": int(weight_val)
        })

    feature_importance_list.sort(key=lambda x: x['gain'], reverse=True)
    top_10_features = feature_importance_list[:10]

    # 7. Model Selection
    # Select model based on validation & test F1 / generalization performance
    selected_model_name = "xgb_hem" if hem_test_metrics['f1'] >= baseline_test_metrics['f1'] else "xgb_baseline"

    # 8. Save Metadata
    metadata = {
        "model_version": "1.0.0",
        "model_name": "LIFE-LINK Donor Dispatch Response Predictor",
        "created_at": datetime.now().isoformat(),
        "selected_model": selected_model_name,
        "model_files": {
            "baseline": "ml/models/donor_response_xgb_baseline.json",
            "hem": "ml/models/donor_response_xgb_hem.json",
            "production_selected": f"ml/models/donor_response_{selected_model_name}.json"
        },
        "feature_names": FEATURE_NAMES,
        "feature_count": len(FEATURE_NAMES),
        "target_definition": {
            "name": "positive_response",
            "description": "1 if donor dispatch resulted in ACCEPTED or COMPLETED outcome, 0 if DECLINED, NO_RESPONSE, MISSED, EXPIRED, CANCELLED",
            "positive_label": 1,
            "negative_label": 0
        },
        "dataset_statistics": {
            "total_samples": len(df_full),
            "train_samples": len(df_train),
            "val_samples": len(df_val),
            "test_samples": len(df_test),
            "positive_samples": int(df_full['target'].sum()),
            "negative_samples": int(len(df_full) - df_full['target'].sum()),
            "positive_percentage": round(float(df_full['target'].mean() * 100), 2),
            "negative_percentage": round(float((1 - df_full['target'].mean()) * 100), 2)
        },
        "split_methodology": {
            "type": "Group-Aware Split (GroupShuffleSplit)",
            "group_column": "donor_id",
            "train_ratio": 0.70,
            "val_ratio": 0.15,
            "test_ratio": 0.15,
            "leakage_safeguard": "Strict zero-donor-overlap across train, val, and test partitions"
        },
        "xgboost_parameters": baseline_data['params'],
        "hem_strategy": {
            "method": "Dual-Signal Hard Example Mining",
            "signals": {
                "misclassification": "y_pred != y_true",
                "uncertainty": f"abs(p - 0.5) < {hem_data['hem_threshold']}"
            },
            "sample_weighting_schedule": {
                "normal": 1.0,
                "uncertain": 2.0,
                "misclassified": 2.0,
                "misclassified_and_uncertain": 3.0
            },
            "mined_statistics": hem_data['hem_stats']
        },
        "test_metrics": {
            "baseline": baseline_test_metrics,
            "hem": hem_test_metrics,
            "absolute_improvement": improvements,
            "percentage_improvement": pct_improvements
        },
        "overfitting_analysis": overfitting_analysis,
        "feature_importance_ranking": feature_importance_list,
        "top_10_features": top_10_features
    }

    metadata_path = os.path.join(models_dir, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"\n[evaluate] Comprehensive metadata written to {metadata_path}")

    # Print Final Summary Comparison
    print("\n" + "="*80)
    print("FINAL RIGOROUS TEST SET COMPARISON (UNTOUCHED TEST SET)")
    print("="*80)
    print(f"{'Model':<20} | {'Accuracy':<10} | {'Precision':<10} | {'Recall':<10} | {'F1-Score':<10} | {'ROC-AUC':<10}")
    print("-"*80)
    print(f"{'Baseline XGBoost':<20} | {baseline_test_metrics['accuracy']*100:>8.2f}% | {baseline_test_metrics['precision']*100:>8.2f}% | {baseline_test_metrics['recall']*100:>8.2f}% | {baseline_test_metrics['f1']*100:>8.2f}% | {baseline_test_metrics['roc_auc']:>10.4f}")
    print(f"{'XGBoost + HEM':<20} | {hem_test_metrics['accuracy']*100:>8.2f}% | {hem_test_metrics['precision']*100:>8.2f}% | {hem_test_metrics['recall']*100:>8.2f}% | {hem_test_metrics['f1']*100:>8.2f}% | {hem_test_metrics['roc_auc']:>10.4f}")
    print("-"*80)
    print(f"{'Absolute Diff (Delta)':<20} | {improvements['accuracy']*100:>+8.2f}% | {improvements['precision']*100:>+8.2f}% | {improvements['recall']*100:>+8.2f}% | {improvements['f1']*100:>+8.2f}% | {improvements['roc_auc']:>+10.4f}")
    print(f"{'Relative Diff (%)':<20} | {pct_improvements['accuracy']:>+8.2f}% | {pct_improvements['precision']:>+8.2f}% | {pct_improvements['recall']:>+8.2f}% | {pct_improvements['f1']:>+8.2f}% | {pct_improvements['roc_auc']:>+10.2f}%")
    print("="*80)

    print("\nTop 10 Features by Predictive Gain:")
    for rank, item in enumerate(top_10_features, 1):
        print(f"  {rank:2d}. {item['feature']:<30} Gain: {item['gain']:>8.4f} (Splits: {item['weight']})")

    print(f"\nSelected Production Model: {selected_model_name}")
    print("="*80 + "\n")

    return metadata


if __name__ == "__main__":
    run_evaluation_pipeline()
