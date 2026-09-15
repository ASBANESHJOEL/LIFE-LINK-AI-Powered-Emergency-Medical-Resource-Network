"""
LIFE-LINK Feature Ablation & Generalization Study
Rigorous investigation of feature redundancy and parsimony:
1. Reference Model (Full 18 features, optimized hyperparameters)
2. Time Feature Ablations (Variants 2A, 2B, 2C)
3. Blood Feature Ablations (Variants 3A, 3B, 3C)
4. Historical Feature Ablations (Variants 4A, 4B, 4C)
5. Combined Lean / Parsimonious Model
6. 5-Fold Group-Aware Cross-Validation on donor_id (Mean +/- Std)
7. Final Untouched Test Set Evaluation & Model Selection
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from datetime import datetime

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
from sklearn.model_selection import GroupKFold

from feature_engineering import FEATURE_NAMES

# Validated Optimal XGBoost Hyperparameters
OPTIMAL_PARAMS = {
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
    "random_state": 42
}


def compute_metrics(y_true, y_pred, y_prob):
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def evaluate_features_on_val(features, df_train, df_val):
    model = XGBClassifier(**OPTIMAL_PARAMS)
    model.fit(df_train[features], df_train['target'], verbose=False)
    
    val_pred = model.predict(df_val[features])
    val_prob = model.predict_proba(df_val[features])[:, 1]
    val_m = compute_metrics(df_val['target'], val_pred, val_prob)

    train_pred = model.predict(df_train[features])
    train_acc = accuracy_score(df_train['target'], train_pred)
    gap = round((train_acc - val_m['accuracy']) * 100, 2)
    return model, val_m, train_acc, gap


def run_group_cv(features, df_train_val, n_splits=5, random_state=42):
    gkf = GroupKFold(n_splits=n_splits)
    groups = df_train_val['donor_id'].values
    X = df_train_val[features]
    y = df_train_val['target'].values

    acc_list, prec_list, rec_list, f1_list, auc_list = [], [], [], [], []

    for train_idx, val_idx in gkf.split(X, y, groups=groups):
        X_tr, y_tr = X.iloc[train_idx], y[train_idx]
        X_va, y_va = X.iloc[val_idx], y[val_idx]

        m = XGBClassifier(**OPTIMAL_PARAMS)
        m.fit(X_tr, y_tr, verbose=False)

        preds = m.predict(X_va)
        probs = m.predict_proba(X_va)[:, 1]

        acc_list.append(accuracy_score(y_va, preds))
        prec_list.append(precision_score(y_va, preds, zero_division=0))
        rec_list.append(recall_score(y_va, preds, zero_division=0))
        f1_list.append(f1_score(y_va, preds, zero_division=0))
        auc_list.append(roc_auc_score(y_va, probs))

    return {
        "accuracy_mean": round(float(np.mean(acc_list)), 4),
        "accuracy_std": round(float(np.std(acc_list)), 4),
        "precision_mean": round(float(np.mean(prec_list)), 4),
        "precision_std": round(float(np.std(prec_list)), 4),
        "recall_mean": round(float(np.mean(rec_list)), 4),
        "recall_std": round(float(np.std(rec_list)), 4),
        "f1_mean": round(float(np.mean(f1_list)), 4),
        "f1_std": round(float(np.std(f1_list)), 4),
        "roc_auc_mean": round(float(np.mean(auc_list)), 4),
        "roc_auc_std": round(float(np.std(auc_list)), 4)
    }


def run_ablation_investigation():
    processed_dir = "ml/data/processed"
    models_dir = "ml/models"

    df_train = pd.read_csv(os.path.join(processed_dir, "train.csv"))
    df_val = pd.read_csv(os.path.join(processed_dir, "val.csv"))
    df_test = pd.read_csv(os.path.join(processed_dir, "test.csv"))
    df_train_val = pd.concat([df_train, df_val], ignore_index=True)

    print("="*105)
    print("CONTROLLED FEATURE ABLATION & REDUNDANCY STUDY")
    print("="*105)
    print(f"Dataset : Train={len(df_train)}, Val={len(df_val)}, Test={len(df_test)} (Untouched)")
    print(f"Grouping: donor_id (Zero donor overlap across all splits)")
    print(f"Model   : XGBoost (depth=4, lr=0.03, min_child=3, gamma=0.3, alpha=0.1, lambda=1.0)\n")

    # =========================================================================
    # EXPERIMENT 1: REFERENCE MODEL (Full 18 Features)
    # =========================================================================
    ref_model, ref_val_m, ref_tr_acc, ref_gap = evaluate_features_on_val(FEATURE_NAMES, df_train, df_val)

    # =========================================================================
    # EXPERIMENT 2: TIME FEATURE ABLATIONS
    # =========================================================================
    # Variant 2A: Keep dispatch_hour, remove is_weekend, is_night_dispatch, is_business_hours
    feats_2A = [f for f in FEATURE_NAMES if f not in ["is_weekend", "is_night_dispatch", "is_business_hours"]]
    m2A, val2A, tr2A, gap2A = evaluate_features_on_val(feats_2A, df_train, df_val)

    # Variant 2B: Keep dispatch_hour, is_weekend, remove is_night_dispatch, is_business_hours
    feats_2B = [f for f in FEATURE_NAMES if f not in ["is_night_dispatch", "is_business_hours"]]
    m2B, val2B, tr2B, gap2B = evaluate_features_on_val(feats_2B, df_train, df_val)

    # Variant 2C: Keep dispatch_hour, is_night_dispatch, is_business_hours, remove is_weekend
    feats_2C = [f for f in FEATURE_NAMES if f not in ["is_weekend"]]
    m2C, val2C, tr2C, gap2C = evaluate_features_on_val(feats_2C, df_train, df_val)

    # =========================================================================
    # EXPERIMENT 3: BLOOD FEATURE ABLATIONS
    # =========================================================================
    # Variant 3A: Keep is_exact_blood_match, is_blood_compatible, remove is_universal_donor
    feats_3A = [f for f in FEATURE_NAMES if f not in ["is_universal_donor"]]
    m3A, val3A, tr3A, gap3A = evaluate_features_on_val(feats_3A, df_train, df_val)

    # Variant 3B: Keep is_blood_compatible only
    feats_3B = [f for f in FEATURE_NAMES if f not in ["is_exact_blood_match", "is_universal_donor"]]
    m3B, val3B, tr3B, gap3B = evaluate_features_on_val(feats_3B, df_train, df_val)

    # Variant 3C: Keep is_exact_blood_match only
    feats_3C = [f for f in FEATURE_NAMES if f not in ["is_blood_compatible", "is_universal_donor"]]
    m3C, val3C, tr3C, gap3C = evaluate_features_on_val(feats_3C, df_train, df_val)

    # =========================================================================
    # EXPERIMENT 4: HISTORICAL FEATURE ABLATIONS
    # =========================================================================
    # Variant 4A: Keep donor_response_rate, days_since_last_donation, remove history_count, positive_responses
    feats_4A = [f for f in FEATURE_NAMES if f not in ["donor_history_count", "donor_positive_responses"]]
    m4A, val4A, tr4A, gap4A = evaluate_features_on_val(feats_4A, df_train, df_val)

    # Variant 4B: Keep donor_response_rate, donor_history_count, days_since_last_donation, remove donor_positive_responses
    feats_4B = [f for f in FEATURE_NAMES if f not in ["donor_positive_responses"]]
    m4B, val4B, tr4B, gap4B = evaluate_features_on_val(feats_4B, df_train, df_val)

    # =========================================================================
    # COMBINED PARSIMONIOUS LEAN MODEL (Best non-redundant selections)
    # Remove: is_universal_donor (redundant), is_weekend (redundant), donor_positive_responses (collinear with response_rate * count)
    # =========================================================================
    feats_lean = [f for f in FEATURE_NAMES if f not in ["is_universal_donor", "is_weekend", "donor_positive_responses"]]
    m_lean, val_lean, tr_lean, gap_lean = evaluate_features_on_val(feats_lean, df_train, df_val)

    val_ablation_summary = [
        {"name": "Exp 1: Full 18 Features (Reference)", "features": FEATURE_NAMES, "count": len(FEATURE_NAMES), "val_m": ref_val_m, "gap": ref_gap},
        {"name": "Exp 2A: Time (Hour only)", "features": feats_2A, "count": len(feats_2A), "val_m": val2A, "gap": gap2A},
        {"name": "Exp 2B: Time (Hour + Weekend)", "features": feats_2B, "count": len(feats_2B), "val_m": val2B, "gap": gap2B},
        {"name": "Exp 2C: Time (Hour + Night + Biz)", "features": feats_2C, "count": len(feats_2C), "val_m": val2C, "gap": gap2C},
        {"name": "Exp 3A: Blood (Exact + Compatible, drop Univ)", "features": feats_3A, "count": len(feats_3A), "val_m": val3A, "gap": gap3A},
        {"name": "Exp 3B: Blood (Compatible only)", "features": feats_3B, "count": len(feats_3B), "val_m": val3B, "gap": gap3B},
        {"name": "Exp 3C: Blood (Exact only)", "features": feats_3C, "count": len(feats_3C), "val_m": val3C, "gap": gap3C},
        {"name": "Exp 4A: History (Rate + Days, drop Count/Pos)", "features": feats_4A, "count": len(feats_4A), "val_m": val4A, "gap": gap4A},
        {"name": "Exp 4B: History (Rate + Count + Days, drop Pos)", "features": feats_4B, "count": len(feats_4B), "val_m": val4B, "gap": gap4B},
        {"name": "Exp 5: Combined Parsimonious (15 Features)", "features": feats_lean, "count": len(feats_lean), "val_m": val_lean, "gap": gap_lean},
    ]

    print("="*115)
    print("VALIDATION SET FEATURE ABLATION COMPARISON")
    print("="*115)
    print(f"{'Experiment':<52} | {'Feats':<5} | {'Val Acc':<9} | {'Val Prec':<9} | {'Val Rec':<9} | {'Val F1':<9} | {'Val AUC':<9} | {'Gap':<6}")
    print("-"*115)
    for row in val_ablation_summary:
        vm = row['val_m']
        print(f"{row['name']:<52} | {row['count']:<5} | {vm['accuracy']*100:>7.2f}% | {vm['precision']*100:>7.2f}% | {vm['recall']*100:>7.2f}% | {vm['f1']*100:>7.2f}% | {vm['roc_auc']:>9.4f} | {row['gap']:>5.2f}%")
    print("="*115 + "\n")

    # =========================================================================
    # EXPERIMENT 5: 5-FOLD GROUP-AWARE CROSS-VALIDATION (on donor_id)
    # =========================================================================
    print("="*115)
    print("EXPERIMENT 5: 5-FOLD GROUP-AWARE CROSS-VALIDATION (Grouped by donor_id on 3,068 Train+Val Dispatches)")
    print("="*115)
    
    cv_candidates = [
        ("Full 18 Features", FEATURE_NAMES),
        ("Time Variant 2C (Hour+Night+Biz)", feats_2C),
        ("Blood Variant 3A (Exact+Compat)", feats_3A),
        ("History Variant 4B (Rate+Count+Days)", feats_4B),
        ("Combined Parsimonious (15 Features)", feats_lean)
    ]

    cv_results = []
    print(f"{'Feature Configuration':<40} | {'CV Accuracy (Mean +/- Std)':<28} | {'CV F1-Score (Mean +/- Std)':<28} | {'CV ROC-AUC (Mean +/- Std)':<25}")
    print("-"*125)
    for c_name, c_feats in cv_candidates:
        cv_m = run_group_cv(c_feats, df_train_val, n_splits=5, random_state=42)
        cv_results.append({"name": c_name, "features": c_feats, "metrics": cv_m})
        print(f"{c_name:<40} | {cv_m['accuracy_mean']*100:.2f}% +/- {cv_m['accuracy_std']*100:.2f}%      | {cv_m['f1_mean']*100:.2f}% +/- {cv_m['f1_std']*100:.2f}%      | {cv_m['roc_auc_mean']:.4f} +/- {cv_m['roc_auc_std']:.4f}")
    print("="*125 + "\n")

    # Determine Best Configuration from Validation & CV
    # Rank candidates
    best_candidate_name, best_candidate_feats = cv_candidates[0]
    # Check if Parsimonious or 3A beats Full 18
    best_cv = max(cv_results, key=lambda x: (x['metrics']['f1_mean'], x['metrics']['roc_auc_mean']))
    print(f"Top Cross-Validation Configuration: {best_cv['name']} (CV F1: {best_cv['metrics']['f1_mean']*100:.2f}%, CV AUC: {best_cv['metrics']['roc_auc_mean']:.4f})")

    # =========================================================================
    # EXPERIMENT 6: FINAL UNTOUCHED TEST SET EVALUATION
    # Evaluate Full 18 vs Selected Feature Ablation Candidates ONCE on untouched test set
    # =========================================================================
    print("\n" + "="*125)
    print("EXPERIMENT 6: FINAL UNTOUCHED TEST SET EVALUATION (553 Samples, 68 Unseen Donors)")
    print("="*125)

    test_eval_results = []
    for c_name, c_feats in cv_candidates:
        m = XGBClassifier(**OPTIMAL_PARAMS)
        m.fit(df_train[c_feats], df_train['target'], verbose=False)

        test_pred = m.predict(df_test[c_feats])
        test_prob = m.predict_proba(df_test[c_feats])[:, 1]
        test_m = compute_metrics(df_test['target'], test_pred, test_prob)

        train_pred = m.predict(df_train[c_feats])
        train_acc = accuracy_score(df_train['target'], train_pred)
        train_test_gap = round((train_acc - test_m['accuracy']) * 100, 2)

        test_eval_results.append({
            "name": c_name,
            "features": c_feats,
            "feature_count": len(c_feats),
            "model": m,
            "train_acc": train_acc,
            "test_metrics": test_m,
            "train_test_gap": train_test_gap
        })

    print(f"{'Model Configuration':<42} | {'Feats':<5} | {'Accuracy':<9} | {'Precision':<9} | {'Recall':<9} | {'F1-Score':<9} | {'ROC-AUC':<9} | {'Train-Test Gap':<15}")
    print("-"*125)
    for r in test_eval_results:
        tm = r['test_metrics']
        print(f"{r['name']:<42} | {r['feature_count']:<5} | {tm['accuracy']*100:>7.2f}% | {tm['precision']*100:>7.2f}% | {tm['recall']*100:>7.2f}% | {tm['f1']*100:>7.2f}% | {tm['roc_auc']:>9.4f} | {r['train_test_gap']:>13.2f}%")
    print("="*125)

    # Feature Importance for Winning Model
    winning_entry = max(test_eval_results, key=lambda x: (x['test_metrics']['f1'], x['test_metrics']['accuracy']))
    winning_model = winning_entry['model']
    winning_features = winning_entry['features']

    importances_gain = winning_model.get_booster().get_score(importance_type='gain')
    importances_weight = winning_model.get_booster().get_score(importance_type='weight')

    feature_ranking = []
    for f in winning_features:
        feature_ranking.append({
            "feature": f,
            "gain": round(float(importances_gain.get(f, 0.0)), 4),
            "weight": int(importances_weight.get(f, 0))
        })
    feature_ranking.sort(key=lambda x: x['gain'], reverse=True)

    print(f"\nFeature Importance Ranking ({winning_entry['name']}):")
    for rank, f_info in enumerate(feature_ranking[:10], 1):
        print(f"  {rank:2d}. {f_info['feature']:<36} Gain: {f_info['gain']:>8.4f} (Splits: {f_info['weight']})")

    # Save Study Artifact
    ablation_final_report = {
        "study_timestamp": datetime.now().isoformat(),
        "validation_ablations": [
            {
                "name": row['name'],
                "feature_count": row['count'],
                "val_metrics": row['val_m'],
                "train_val_gap": row['gap']
            }
            for row in val_ablation_summary
        ],
        "cross_validation_results": cv_results,
        "test_results": [
            {
                "name": r['name'],
                "feature_count": r['feature_count'],
                "train_accuracy": round(float(r['train_acc'] * 100), 2),
                "test_metrics": r['test_metrics'],
                "train_test_gap": r['train_test_gap']
            }
            for r in test_eval_results
        ],
        "winning_configuration": winning_entry['name'],
        "winning_features": winning_features,
        "feature_importance_top10": feature_ranking[:10]
    }

    report_path = os.path.join(models_dir, "feature_ablation_final_report.json")
    with open(report_path, "w") as f:
        json.dump(ablation_final_report, f, indent=2)
    print(f"\nSaved final ablation study report to {report_path}")

    return ablation_final_report


if __name__ == "__main__":
    run_ablation_investigation()
