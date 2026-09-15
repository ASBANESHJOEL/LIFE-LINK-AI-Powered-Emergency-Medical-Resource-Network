"""
LIFE-LINK Baseline XGBoost Training
Trains a regularized, conservative binary classification model on the 18 approved features.
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


def train_baseline_model(
    processed_dir: str = "ml/data/processed",
    models_dir: str = "ml/models",
    random_state: int = 42
):
    os.makedirs(models_dir, exist_ok=True)
    
    train_path = os.path.join(processed_dir, "train.csv")
    val_path = os.path.join(processed_dir, "val.csv")
    test_path = os.path.join(processed_dir, "test.csv")

    if not os.path.exists(train_path) or not os.path.exists(val_path) or not os.path.exists(test_path):
        print("[train_baseline] Datasets not found. Building ML dataset...")
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

    # Scientifically validated optimal hyperparameters
    baseline_params = {
        "n_estimators": 300,
        "max_depth": 4,
        "learning_rate": 0.03,
        "min_child_weight": 3,
        "gamma": 0.3,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "random_state": random_state
    }

    print("[train_baseline] Training Baseline XGBoost Classifier...")
    model = XGBClassifier(**baseline_params)
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        verbose=False
    )

    # Predictions
    train_pred = model.predict(X_train)
    train_prob = model.predict_proba(X_train)[:, 1]

    val_pred = model.predict(X_val)
    val_prob = model.predict_proba(X_val)[:, 1]

    test_pred = model.predict(X_test)
    test_prob = model.predict_proba(X_test)[:, 1]

    train_metrics = compute_metrics(y_train, train_pred, train_prob)
    val_metrics = compute_metrics(y_val, val_pred, val_prob)
    test_metrics = compute_metrics(y_test, test_pred, test_prob)

    # Save model
    model_save_path = os.path.join(models_dir, "donor_response_xgb_baseline.json")
    model.save_model(model_save_path)
    print(f"[train_baseline] Model saved to {model_save_path}")

    # Report
    print("\n" + "="*55)
    print("BASELINE XGBOOST RESULTS")
    print("="*55)
    print(f"Train Metrics: Acc={train_metrics['accuracy']*100:.2f}%, Prec={train_metrics['precision']*100:.2f}%, Rec={train_metrics['recall']*100:.2f}%, F1={train_metrics['f1']*100:.2f}%, ROC-AUC={train_metrics['roc_auc']:.4f}")
    print(f"Val Metrics  : Acc={val_metrics['accuracy']*100:.2f}%, Prec={val_metrics['precision']*100:.2f}%, Rec={val_metrics['recall']*100:.2f}%, F1={val_metrics['f1']*100:.2f}%, ROC-AUC={val_metrics['roc_auc']:.4f}")
    print(f"Test Metrics : Acc={test_metrics['accuracy']*100:.2f}%, Prec={test_metrics['precision']*100:.2f}%, Rec={test_metrics['recall']*100:.2f}%, F1={test_metrics['f1']*100:.2f}%, ROC-AUC={test_metrics['roc_auc']:.4f}")
    print(f"Train-Test Gap: Accuracy Gap = {(train_metrics['accuracy'] - test_metrics['accuracy'])*100:.2f}%, F1 Gap = {(train_metrics['f1'] - test_metrics['f1'])*100:.2f}%")
    print(f"Confusion Matrix (Test):\n{np.array(test_metrics['confusion_matrix'])}")
    print("="*55 + "\n")

    return model, {
        "params": baseline_params,
        "train_metrics": train_metrics,
        "val_metrics": val_metrics,
        "test_metrics": test_metrics
    }


if __name__ == "__main__":
    train_baseline_model()
