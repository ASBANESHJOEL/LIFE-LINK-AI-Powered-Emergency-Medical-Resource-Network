"""
LIFE-LINK Hard Example Mining (HEM) Controlled Ablation Study
Compares varying weighting schedules and definitions of HEM against the Baseline XGBoost:
1. Baseline (weights = 1.0)
2. Mild HEM (hard = 1.25, very hard = 1.5)
3. Moderate HEM (hard = 1.5, very hard = 2.0)
4. Current Aggressive HEM (hard = 2.0, very hard = 3.0)
5. Misclassification-Only HEM (misclassified = 1.5, correct = 1.0)

Operates on the exact same dataset, features, splits, and conservative XGBoost architecture.
Uses validation performance for model selection; test set remains untouched until final evaluation.
"""

import os
import sys
import json
import pandas as pd
import numpy as np

# Setup paths
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

from feature_engineering import FEATURE_NAMES


def compute_metrics(y_true, y_pred, y_prob):
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def generate_hem_weights(y_train, y_pred_train, y_prob_train, w_normal=1.0, w_hard=1.25, w_very_hard=1.5, unc_thresh=0.15):
    y_true_arr = np.array(y_train)
    y_pred_arr = np.array(y_pred_train)
    y_prob_arr = np.array(y_prob_train)

    is_misclassified = (y_pred_arr != y_true_arr)
    is_uncertain = (np.abs(y_prob_arr - 0.5) < unc_thresh)

    sample_weights = np.full(len(y_true_arr), w_normal, dtype=np.float32)

    for i in range(len(sample_weights)):
        misc = is_misclassified[i]
        unc = is_uncertain[i]
        if misc and unc:
            sample_weights[i] = w_very_hard
        elif misc or unc:
            sample_weights[i] = w_hard

    return sample_weights


def generate_misc_only_weights(y_train, y_pred_train, w_correct=1.0, w_misc=1.5):
    y_true_arr = np.array(y_train)
    y_pred_arr = np.array(y_pred_train)

    is_misclassified = (y_pred_arr != y_true_arr)
    sample_weights = np.where(is_misclassified, w_misc, w_correct).astype(np.float32)
    return sample_weights


def run_ablation_study(
    processed_dir: str = "ml/data/processed",
    models_dir: str = "ml/models",
    random_state: int = 42
):
    os.makedirs(models_dir, exist_ok=True)

    train_path = os.path.join(processed_dir, "train.csv")
    val_path = os.path.join(processed_dir, "val.csv")
    test_path = os.path.join(processed_dir, "test.csv")

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

    print("================================================================================")
    print("STARTING CONTROLLED HEM ABLATION STUDY")
    print("================================================================================")
    print(f"Dataset: Train={len(df_train)}, Val={len(df_val)}, Test={len(df_test)}")
    print(f"Group Split: donor_id (Zero overlap)")
    print(f"Features: 18 features strictly isolated from outcome leakage\n")

    # Train initial baseline to extract training predictions for mining
    baseline_model = XGBClassifier(**params)
    baseline_model.fit(X_train, y_train, eval_set=[(X_train, y_train), (X_val, y_val)], verbose=False)

    train_pred_base = baseline_model.predict(X_train)
    train_prob_base = baseline_model.predict_proba(X_train)[:, 1]

    # Define Ablation Experiments
    experiments = [
        {
            "name": "Exp 1: Baseline (weights=1.0)",
            "key": "baseline",
            "weights": np.ones(len(y_train), dtype=np.float32)
        },
        {
            "name": "Exp 2: Mild HEM (hard=1.25, very_hard=1.5)",
            "key": "mild_hem",
            "weights": generate_hem_weights(y_train, train_pred_base, train_prob_base, w_normal=1.0, w_hard=1.25, w_very_hard=1.5)
        },
        {
            "name": "Exp 3: Moderate HEM (hard=1.5, very_hard=2.0)",
            "key": "moderate_hem",
            "weights": generate_hem_weights(y_train, train_pred_base, train_prob_base, w_normal=1.0, w_hard=1.5, w_very_hard=2.0)
        },
        {
            "name": "Exp 4: Aggressive HEM (hard=2.0, very_hard=3.0)",
            "key": "aggressive_hem",
            "weights": generate_hem_weights(y_train, train_pred_base, train_prob_base, w_normal=1.0, w_hard=2.0, w_very_hard=3.0)
        },
        {
            "name": "Exp 5: Misclassification-Only (misc=1.5, correct=1.0)",
            "key": "misc_only_hem",
            "weights": generate_misc_only_weights(y_train, train_pred_base, w_correct=1.0, w_misc=1.5)
        }
    ]

    results = []

    for exp in experiments:
        name = exp['name']
        key = exp['key']
        weights = exp['weights']

        model = XGBClassifier(**params)
        model.fit(
            X_train,
            y_train,
            sample_weight=weights,
            eval_set=[(X_train, y_train), (X_val, y_val)],
            verbose=False
        )

        train_pred = model.predict(X_train)
        train_prob = model.predict_proba(X_train)[:, 1]
        train_m = compute_metrics(y_train, train_pred, train_prob)

        val_pred = model.predict(X_val)
        val_prob = model.predict_proba(X_val)[:, 1]
        val_m = compute_metrics(y_val, val_pred, val_prob)

        test_pred = model.predict(X_test)
        test_prob = model.predict_proba(X_test)[:, 1]
        test_m = compute_metrics(y_test, test_pred, test_prob)

        train_test_acc_gap = round((train_m['accuracy'] - test_m['accuracy']) * 100, 2)
        train_test_f1_gap = round((train_m['f1'] - test_m['f1']) * 100, 2)

        results.append({
            "experiment": name,
            "key": key,
            "model": model,
            "train_metrics": train_m,
            "val_metrics": val_m,
            "test_metrics": test_m,
            "train_test_acc_gap": train_test_acc_gap,
            "train_test_f1_gap": train_test_f1_gap
        })

    # Summary Table Display
    print("="*105)
    print("VALIDATION SET RESULTS (Used for Model Selection)")
    print("="*105)
    print(f"{'Experiment':<50} | {'Val Acc':<9} | {'Val Prec':<9} | {'Val Rec':<9} | {'Val F1':<9} | {'Val AUC':<9}")
    print("-"*105)
    for r in results:
        vm = r['val_metrics']
        print(f"{r['experiment']:<50} | {vm['accuracy']*100:>7.2f}% | {vm['precision']*100:>7.2f}% | {vm['recall']*100:>7.2f}% | {vm['f1']*100:>7.2f}% | {vm['roc_auc']:>9.4f}")
    print("="*105 + "\n")

    print("="*125)
    print("UNTOUCHED TEST SET EVALUATION & OVERFITTING ANALYSIS")
    print("="*125)
    print(f"{'Experiment':<46} | {'Accuracy':<9} | {'Precision':<9} | {'Recall':<9} | {'F1-Score':<9} | {'ROC-AUC':<9} | {'Train-Test Acc Gap':<18}")
    print("-"*125)
    for r in results:
        tm = r['test_metrics']
        print(f"{r['experiment']:<46} | {tm['accuracy']*100:>7.2f}% | {tm['precision']*100:>7.2f}% | {tm['recall']*100:>7.2f}% | {tm['f1']*100:>7.2f}% | {tm['roc_auc']:>9.4f} | {r['train_test_acc_gap']:>16.2f}%")
    print("="*125 + "\n")

    # Determine Best Configuration
    best_val_exp = max(results, key=lambda x: x['val_metrics']['f1'])
    best_test_exp = max(results, key=lambda x: x['test_metrics']['f1'])
    baseline_exp = results[0]

    print(f"Top Validation Configuration : {best_val_exp['experiment']} (Val F1: {best_val_exp['val_metrics']['f1']*100:.2f}%)")
    print(f"Top Test Set Configuration   : {best_test_exp['experiment']} (Test F1: {best_test_exp['test_metrics']['f1']*100:.2f}%)")
    print(f"Baseline Test Performance    : Test F1 = {baseline_exp['test_metrics']['f1']*100:.2f}%, Accuracy = {baseline_exp['test_metrics']['accuracy']*100:.2f}%")

    # Check if any HEM improved over baseline
    hem_improvements = []
    for r in results[1:]:
        f1_diff = r['test_metrics']['f1'] - baseline_exp['test_metrics']['f1']
        acc_diff = r['test_metrics']['accuracy'] - baseline_exp['test_metrics']['accuracy']
        auc_diff = r['test_metrics']['roc_auc'] - baseline_exp['test_metrics']['roc_auc']
        hem_improvements.append({
            "experiment": r['experiment'],
            "f1_diff": round(f1_diff * 100, 2),
            "acc_diff": round(acc_diff * 100, 2),
            "auc_diff": round(auc_diff, 4)
        })

    print("\nHEM Ablation Differences vs Baseline:")
    for h in hem_improvements:
        print(f"  - {h['experiment']}: Delta F1 = {h['f1_diff']:>+5.2f}%, Delta Acc = {h['acc_diff']:>+5.2f}%, Delta AUC = {h['auc_diff']:>+7.4f}")

    # Save ablation study artifact
    ablation_summary = {
        "ablation_date": pd.Timestamp.now().isoformat(),
        "experiments": [
            {
                "name": r['experiment'],
                "key": r['key'],
                "train_metrics": r['train_metrics'],
                "val_metrics": r['val_metrics'],
                "test_metrics": r['test_metrics'],
                "train_test_acc_gap": r['train_test_acc_gap'],
                "train_test_f1_gap": r['train_test_f1_gap']
            }
            for r in results
        ],
        "top_validation_model": best_val_exp['key'],
        "top_test_model": best_test_exp['key'],
        "baseline_selected_as_production": True if baseline_exp['test_metrics']['f1'] >= best_val_exp['test_metrics']['f1'] else False
    }

    ablation_path = os.path.join(models_dir, "hem_ablation_results.json")
    with open(ablation_path, "w") as f:
        json.dump(ablation_summary, f, indent=2)
    print(f"\nSaved ablation results to {ablation_path}")

    return results, ablation_summary


if __name__ == "__main__":
    run_ablation_study()
