"""
LIFE-LINK Hard Example Mining (HEM) XGBoost Training
Identifies difficult training samples via misclassification and prediction uncertainty,
constructs non-destructive sample weights, and retrains the XGBoost architecture.

Guarantees:
- Hard Example Mining is strictly performed ONLY on X_train / y_train.
- No synthetic labels or row duplication.
- Model architecture is identical to baseline for direct scientific comparison.
- Test set remains completely untouched during threshold selection.
"""

import os
import sys
import json
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


def compute_metrics(y_true, y_pred, y_prob):
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def mine_hard_examples(y_train, y_pred_train, y_prob_train, uncertainty_threshold: float = 0.15):
    """
    Identifies hard training examples using dual signals:
    1. Misclassification (y_pred != y_true)
    2. Prediction uncertainty (|p - 0.5| < threshold)
    
    Sample Weights:
    - Normal (Correct & Confident)        : 1.0
    - Uncertain (Correct & Uncertain)     : 2.0
    - Misclassified (Misclassified only)  : 2.0
    - Very Hard (Misclassified & Uncertain): 3.0
    """
    y_true_arr = np.array(y_train)
    y_pred_arr = np.array(y_pred_train)
    y_prob_arr = np.array(y_prob_train)

    is_misclassified = (y_pred_arr != y_true_arr)
    is_uncertain = (np.abs(y_prob_arr - 0.5) < uncertainty_threshold)

    sample_weights = np.ones(len(y_true_arr), dtype=np.float32)

    for i in range(len(sample_weights)):
        misc = is_misclassified[i]
        unc = is_uncertain[i]

        if misc and unc:
            sample_weights[i] = 3.0
        elif misc or unc:
            sample_weights[i] = 2.0
        else:
            sample_weights[i] = 1.0

    stats = {
        "total_samples": len(y_true_arr),
        "misclassified_count": int(np.sum(is_misclassified)),
        "uncertain_count": int(np.sum(is_uncertain)),
        "very_hard_count": int(np.sum(is_misclassified & is_uncertain)),
        "easy_count": int(np.sum(~is_misclassified & ~is_uncertain)),
        "uncertainty_threshold": uncertainty_threshold,
        "weight_distribution": {
            "weight_1_0": int(np.sum(sample_weights == 1.0)),
            "weight_2_0": int(np.sum(sample_weights == 2.0)),
            "weight_3_0": int(np.sum(sample_weights == 3.0))
        }
    }

    return sample_weights, stats


def train_hem_model(
    processed_dir: str = "ml/data/processed",
    models_dir: str = "ml/models",
    random_state: int = 42
):
    os.makedirs(models_dir, exist_ok=True)

    train_path = os.path.join(processed_dir, "train.csv")
    val_path = os.path.join(processed_dir, "val.csv")
    test_path = os.path.join(processed_dir, "test.csv")

    if not os.path.exists(train_path) or not os.path.exists(val_path) or not os.path.exists(test_path):
        df_train, df_val, df_test, _ = build_ml_dataset(processed_dir=processed_dir, random_state=random_state)
    else:
        df_train = pd.read_csv(train_path)
        df_val = pd.read_csv(val_path)
        df_test = pd.read_csv(test_path)

    X_train = df_train[FEATURE_NAMES]
    y_train = df_train['target']

    X_val = df_val[FEATURE_NAMES]
    y_val = df_val['target']

    X_test = df_test[FEATURE_NAMES]
    y_test = df_test['target']

    params = {
        "n_estimators": 300,
        "max_depth": 4,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "random_state": random_state
    }

    # Step 1: Train baseline model on X_train to extract initial training predictions
    print("[train_hem] Step 1: Fitting initial model on X_train for Hard Example Mining...")
    initial_model = XGBClassifier(**params)
    initial_model.fit(X_train, y_train, verbose=False)

    train_preds_initial = initial_model.predict(X_train)
    train_probs_initial = initial_model.predict_proba(X_train)[:, 1]

    # Step 2: Test candidate uncertainty thresholds on Validation Set
    candidate_thresholds = [0.10, 0.15, 0.20]
    best_threshold = 0.15
    best_val_f1 = -1.0
    best_model = None
    best_stats = None
    threshold_results = {}

    print("\n[train_hem] Step 2: Evaluating HEM Thresholds on Validation Set (Test set remains untouched)...")
    for thresh in candidate_thresholds:
        weights, stats = mine_hard_examples(y_train, train_preds_initial, train_probs_initial, uncertainty_threshold=thresh)
        
        candidate_model = XGBClassifier(**params)
        candidate_model.fit(
            X_train,
            y_train,
            sample_weight=weights,
            eval_set=[(X_train, y_train), (X_val, y_val)],
            verbose=False
        )

        val_pred = candidate_model.predict(X_val)
        val_prob = candidate_model.predict_proba(X_val)[:, 1]
        val_metrics = compute_metrics(y_val, val_pred, val_prob)

        threshold_results[str(thresh)] = {
            "stats": stats,
            "val_metrics": val_metrics
        }
        print(f"  - Threshold {thresh:.2f}: Val F1 = {val_metrics['f1']*100:.2f}%, ROC-AUC = {val_metrics['roc_auc']:.4f}, Hard Samples = {stats['very_hard_count'] + stats['misclassified_count']}")

        if val_metrics['f1'] > best_val_f1:
            best_val_f1 = val_metrics['f1']
            best_threshold = thresh
            best_model = candidate_model
            best_stats = stats

    print(f"\n[train_hem] Selected optimal HEM uncertainty threshold based on validation: {best_threshold}")

    # Step 3: Compute final metrics
    train_pred = best_model.predict(X_train)
    train_prob = best_model.predict_proba(X_train)[:, 1]

    val_pred = best_model.predict(X_val)
    val_prob = best_model.predict_proba(X_val)[:, 1]

    test_pred = best_model.predict(X_test)
    test_prob = best_model.predict_proba(X_test)[:, 1]

    train_metrics = compute_metrics(y_train, train_pred, train_prob)
    val_metrics = compute_metrics(y_val, val_pred, val_prob)
    test_metrics = compute_metrics(y_test, test_pred, test_prob)

    # Save HEM model
    model_save_path = os.path.join(models_dir, "donor_response_xgb_hem.json")
    best_model.save_model(model_save_path)
    print(f"[train_hem] HEM Model saved to {model_save_path}")

    # Report
    print("\n" + "="*55)
    print("XGBOOST + HARD EXAMPLE MINING (HEM) RESULTS")
    print("="*55)
    print(f"Hard Example Stats (Train Set):")
    print(f"  - Total Training Samples: {best_stats['total_samples']}")
    print(f"  - Misclassified Samples : {best_stats['misclassified_count']}")
    print(f"  - Uncertain Samples     : {best_stats['uncertain_count']}")
    print(f"  - Very Hard (Both)      : {best_stats['very_hard_count']}")
    print(f"  - Normal (Weight 1.0)   : {best_stats['weight_distribution']['weight_1_0']}")
    print(f"  - Hard (Weight 2.0)     : {best_stats['weight_distribution']['weight_2_0']}")
    print(f"  - Very Hard (Weight 3.0): {best_stats['weight_distribution']['weight_3_0']}")
    print("-" * 55)
    print(f"Train Metrics: Acc={train_metrics['accuracy']*100:.2f}%, Prec={train_metrics['precision']*100:.2f}%, Rec={train_metrics['recall']*100:.2f}%, F1={train_metrics['f1']*100:.2f}%, ROC-AUC={train_metrics['roc_auc']:.4f}")
    print(f"Val Metrics  : Acc={val_metrics['accuracy']*100:.2f}%, Prec={val_metrics['precision']*100:.2f}%, Rec={val_metrics['recall']*100:.2f}%, F1={val_metrics['f1']*100:.2f}%, ROC-AUC={val_metrics['roc_auc']:.4f}")
    print(f"Test Metrics : Acc={test_metrics['accuracy']*100:.2f}%, Prec={test_metrics['precision']*100:.2f}%, Rec={test_metrics['recall']*100:.2f}%, F1={test_metrics['f1']*100:.2f}%, ROC-AUC={test_metrics['roc_auc']:.4f}")
    print(f"Train-Test Gap: Accuracy Gap = {(train_metrics['accuracy'] - test_metrics['accuracy'])*100:.2f}%, F1 Gap = {(train_metrics['f1'] - test_metrics['f1'])*100:.2f}%")
    print(f"Confusion Matrix (Test):\n{np.array(test_metrics['confusion_matrix'])}")
    print("="*55 + "\n")

    return best_model, {
        "params": params,
        "hem_threshold": best_threshold,
        "hem_stats": best_stats,
        "threshold_tuning": threshold_results,
        "train_metrics": train_metrics,
        "val_metrics": val_metrics,
        "test_metrics": test_metrics
    }


if __name__ == "__main__":
    train_hem_model()
