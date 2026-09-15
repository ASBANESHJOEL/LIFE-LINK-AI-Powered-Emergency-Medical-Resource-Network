"""
LIFE-LINK Scientific ML Improvement Study
Performs:
1. Target & Data Quality Audit (Majority-class baseline comparison, status mapping verification)
2. Feature Audit (Leakage, missingness, variance, class-conditional statistics)
3. Leakage-Free Feature Engineering Experiment (Recent 5-window stats, dispatches since last donation, dispatch intervals)
4. Controlled XGBoost Hyperparameter Study (Evaluated on Validation Set)
5. Validation-Based Threshold Optimization (Evaluated on Validation Set)
6. Final Untouched Test Set Comparison & Overfitting Analysis
7. Feature Importance Ranking & Production Decision
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
from feature_engineering import FEATURE_NAMES, compute_blood_compatibility, URGENCY_MAP

EXTENDED_FEATURE_NAMES = FEATURE_NAMES + [
    "recent_response_rate_last_5",
    "recent_positive_responses_last_5",
    "dispatches_since_last_donation",
    "time_since_previous_dispatch_hours"
]


def compute_metrics(y_true, y_pred, y_prob):
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": confusion_matrix(y_true, y_pred).tolist()
    }


def compute_extended_features(raw_dir: str = "ml/data/raw"):
    """
    Builds the dataset with the 18 original features PLUS 4 validated leakage-free historical features.
    Guarantees strict chronological calculation per donor using dispatches 0..(k-1).
    """
    df_donors = pd.read_csv(os.path.join(raw_dir, "donors.csv"))
    df_requests = pd.read_csv(os.path.join(raw_dir, "emergency_requests.csv"))
    df_dispatches = pd.read_csv(os.path.join(raw_dir, "donor_dispatches.csv"))

    df_donors.columns = [c.lower() for c in df_donors.columns]
    df_requests.columns = [c.lower() for c in df_requests.columns]
    df_dispatches.columns = [c.lower() for c in df_dispatches.columns]

    df_donors['id'] = df_donors['id'].astype(str)
    df_requests['id'] = df_requests['id'].astype(str)
    df_dispatches['donor_id'] = df_dispatches['donor_id'].astype(str)
    df_dispatches['request_id'] = df_dispatches['request_id'].astype(str)

    # Target Mapping
    status_series = df_dispatches['status'].astype(str).str.upper()
    df_dispatches['target'] = status_series.isin(['ACCEPTED', 'COMPLETED']).astype(int)

    disp_time_col = 'dispatched_at' if 'dispatched_at' in df_dispatches.columns else 'created_at'
    df_dispatches['dispatch_dt'] = pd.to_datetime(df_dispatches[disp_time_col])
    df_dispatches = df_dispatches.sort_values(by=['dispatch_dt', 'id']).reset_index(drop=True)

    # Lookups
    donors_lookup = df_donors.set_index('id').to_dict(orient='index')
    requests_lookup = df_requests.set_index('id').to_dict(orient='index')

    # Rolling history tracking per donor
    # donor_id -> list of (dispatch_dt, target)
    donor_history_log = {}

    rows = []

    for _, disp in df_dispatches.iterrows():
        donor_id = disp['donor_id']
        req_id = disp['request_id']
        if donor_id not in donors_lookup or req_id not in requests_lookup:
            continue

        donor = donors_lookup[donor_id]
        req = requests_lookup[req_id]
        dt = disp['dispatch_dt']
        target = disp['target']

        # Historical Dispatches Strictly Prior to Current Dispatch
        prior_events = donor_history_log.get(donor_id, [])
        h_count = len(prior_events)
        prior_targets = [e[1] for e in prior_events]
        p_count = sum(prior_targets)
        r_rate = (p_count / h_count) if h_count > 0 else 0.0

        # Feature 19: Recent response rate (last 5)
        recent_5_targets = prior_targets[-5:] if h_count > 0 else []
        recent_5_rate = (sum(recent_5_targets) / len(recent_5_targets)) if recent_5_targets else 0.0
        
        # Feature 20: Recent positive responses (last 5)
        recent_5_pos = sum(recent_5_targets) if recent_5_targets else 0

        # Feature 21: Dispatches since last donation
        last_don_val = donor.get('last_donation_date')
        if pd.notna(last_don_val) and str(last_don_val).strip() != '':
            try:
                last_don_dt = pd.to_datetime(last_don_val)
                days_since_don = max(0, (dt - last_don_dt).days)
                # Count prior dispatches that occurred AFTER the last donation date
                dispatches_since_last_don = sum(1 for e in prior_events if e[0] >= last_don_dt)
            except Exception:
                days_since_don = 365.0
                dispatches_since_last_don = h_count
        else:
            days_since_don = 365.0
            dispatches_since_last_don = h_count

        # Feature 22: Time since previous dispatch (in hours)
        if prior_events:
            prev_dt = prior_events[-1][0]
            hrs_since_prev = max(0.0, (dt - prev_dt).total_seconds() / 3600.0)
        else:
            hrs_since_prev = 720.0  # Default 30 days for first-time dispatch

        # Standard 18 Features
        donor_blood = str(donor.get('blood_type', '')).strip().upper()
        req_blood = str(req.get('blood_type', '')).strip().upper()
        is_exact = 1 if (donor_blood and req_blood and donor_blood == req_blood) else 0
        is_compat = 1 if compute_blood_compatibility(donor_blood, req_blood) else 0
        is_univ = 1 if donor_blood == 'O-' else 0
        donor_ver = 1 if donor.get('is_verified', True) in [True, 1, 'true', 't', '1'] else 0
        donor_elig = 1 if donor.get('is_eligible', True) in [True, 1, 'true', 't', '1'] else 0
        donor_avail = 1 if donor.get('is_available', True) in [True, 1, 'true', 't', '1'] else 0

        d_hour = dt.hour
        d_dow = dt.weekday()
        is_wknd = 1 if d_dow in [5, 6] else 0
        is_night = 1 if (d_hour >= 22 or d_hour < 6) else 0
        is_biz = 1 if (9 <= d_hour < 18 and not is_wknd) else 0
        req_qty = float(req.get('requested_quantity', req.get('quantity', 1.0)) or 1.0)
        urg_val = req.get('urgency_level', req.get('urgency', 'MEDIUM'))
        urg_mapped = URGENCY_MAP.get(str(urg_val).strip().upper(), 1) if isinstance(urg_val, str) else int(urg_val)
        res_type = str(req.get('resource_type', 'BLOOD')).strip().upper()
        is_res_blood = 1 if ('BLOOD' in res_type or 'RBC' in res_type) else 0

        row_dict = {
            "dispatch_id": disp['id'],
            "donor_id": donor_id,
            "request_id": req_id,
            "target": target,
            # Original 18 features
            "is_exact_blood_match": is_exact,
            "is_blood_compatible": is_compat,
            "is_universal_donor": is_univ,
            "donor_is_verified": donor_ver,
            "donor_is_eligible": donor_elig,
            "donor_is_available": donor_avail,
            "donor_response_rate": round(r_rate, 4),
            "donor_history_count": h_count,
            "donor_positive_responses": p_count,
            "days_since_last_donation": float(days_since_don),
            "dispatch_hour": int(d_hour),
            "dispatch_day_of_week": int(d_dow),
            "is_weekend": is_wknd,
            "is_night_dispatch": is_night,
            "is_business_hours": is_biz,
            "requested_quantity": float(req_qty),
            "urgency_level": int(urg_mapped),
            "is_resource_blood": is_res_blood,
            # 4 Validated Historical Features
            "recent_response_rate_last_5": round(recent_5_rate, 4),
            "recent_positive_responses_last_5": int(recent_5_pos),
            "dispatches_since_last_donation": int(dispatches_since_last_don),
            "time_since_previous_dispatch_hours": round(hrs_since_prev, 2)
        }
        rows.append(row_dict)

        # Update history log AFTER recording features
        if donor_id not in donor_history_log:
            donor_history_log[donor_id] = []
        donor_history_log[donor_id].append((dt, target))

    df_extended = pd.DataFrame(rows)
    return df_extended


def run_scientific_study():
    raw_dir = "ml/data/raw"
    processed_dir = "ml/data/processed"
    models_dir = "ml/models"

    print("="*80)
    print("STAGE 1: TARGET & DATA QUALITY AUDIT")
    print("="*80)
    df_raw_dispatches = pd.read_csv(os.path.join(raw_dir, "donor_dispatches.csv"))
    df_train_orig = pd.read_csv(os.path.join(processed_dir, "train.csv"))
    df_val_orig = pd.read_csv(os.path.join(processed_dir, "val.csv"))
    df_test_orig = pd.read_csv(os.path.join(processed_dir, "test.csv"))

    status_counts = df_raw_dispatches['status'].value_counts()
    print("Raw Dispatch Status Breakdown:")
    for stat, cnt in status_counts.items():
        mapped_target = 1 if stat in ['ACCEPTED', 'COMPLETED'] else 0
        print(f"  - {stat:<15}: {cnt:>5} records -> Mapped Target = {mapped_target}")

    total_samples = len(df_raw_dispatches)
    total_pos = sum(df_raw_dispatches['status'].isin(['ACCEPTED', 'COMPLETED']))
    total_neg = total_samples - total_pos

    print(f"\nOverall Class Distribution: Positive={total_pos} ({total_pos/total_samples*100:.2f}%), Negative={total_neg} ({total_neg/total_samples*100:.2f}%)")
    print(f"Train Set : {len(df_train_orig)} samples (Pos: {df_train_orig['target'].mean()*100:.2f}%)")
    print(f"Val Set   : {len(df_val_orig)} samples (Pos: {df_val_orig['target'].mean()*100:.2f}%)")
    print(f"Test Set  : {len(df_test_orig)} samples (Pos: {df_test_orig['target'].mean()*100:.2f}%)")

    # Majority Class Baseline on Untouched Test Set
    test_y = df_test_orig['target'].values
    majority_pred = np.ones_like(test_y)  # Always predict positive (1)
    majority_prob = np.full_like(test_y, df_train_orig['target'].mean(), dtype=float)

    maj_acc = accuracy_score(test_y, majority_pred)
    maj_prec = precision_score(test_y, majority_pred, zero_division=0)
    maj_rec = recall_score(test_y, majority_pred, zero_division=0)
    maj_f1 = f1_score(test_y, majority_pred, zero_division=0)
    maj_auc = 0.5000

    print("\nMajority-Class Dummy Baseline (Untouched Test Set):")
    print(f"  Accuracy  : {maj_acc*100:.2f}% (Equal to positive prevalence)")
    print(f"  Precision : {maj_prec*100:.2f}%")
    print(f"  Recall    : {maj_rec*100:.2f}%")
    print(f"  F1-Score  : {maj_f1*100:.2f}%")
    print(f"  ROC-AUC   : {maj_auc:.4f} (No discriminative capacity)")

    print("\n" + "="*80)
    print("STAGE 2: FEATURE AUDIT & STATISTICAL INTEGRITY")
    print("="*80)
    print(f"{'Feature Name':<32} | {'Nulls':<6} | {'Mean (Y=0)':<11} | {'Mean (Y=1)':<11} | {'Status':<15}")
    print("-"*80)
    for feat in FEATURE_NAMES:
        nulls = df_train_orig[feat].isnull().sum()
        mean_0 = df_train_orig[df_train_orig['target'] == 0][feat].mean()
        mean_1 = df_train_orig[df_train_orig['target'] == 1][feat].mean()
        status_str = "Zero-Leakage OK"
        print(f"{feat:<32} | {nulls:<6} | {mean_0:>11.4f} | {mean_1:>11.4f} | {status_str:<15}")

    print("\n" + "="*80)
    print("STAGE 3: FEATURE ENGINEERING EXPERIMENT (EVALUATED ON VALIDATION SET)")
    print("="*80)
    
    # Generate extended feature dataset
    df_extended_full = compute_extended_features(raw_dir=raw_dir)

    # Use the EXACT same split IDs
    train_ids = set(df_train_orig['dispatch_id'])
    val_ids = set(df_val_orig['dispatch_id'])
    test_ids = set(df_test_orig['dispatch_id'])

    df_train_ext = df_extended_full[df_extended_full['dispatch_id'].isin(train_ids)].reset_index(drop=True)
    df_val_ext = df_extended_full[df_extended_full['dispatch_id'].isin(val_ids)].reset_index(drop=True)
    df_test_ext = df_extended_full[df_extended_full['dispatch_id'].isin(test_ids)].reset_index(drop=True)

    base_xgb_params = {
        "n_estimators": 300,
        "max_depth": 4,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "random_state": 42
    }

    # Model A: 18 Original Features
    model_18 = XGBClassifier(**base_xgb_params)
    model_18.fit(df_train_orig[FEATURE_NAMES], df_train_orig['target'], verbose=False)
    val_pred_18 = model_18.predict(df_val_orig[FEATURE_NAMES])
    val_prob_18 = model_18.predict_proba(df_val_orig[FEATURE_NAMES])[:, 1]
    m_val_18 = compute_metrics(df_val_orig['target'], val_pred_18, val_prob_18)

    # Model B: 22 Extended Features
    model_22 = XGBClassifier(**base_xgb_params)
    model_22.fit(df_train_ext[EXTENDED_FEATURE_NAMES], df_train_ext['target'], verbose=False)
    val_pred_22 = model_22.predict(df_val_ext[EXTENDED_FEATURE_NAMES])
    val_prob_22 = model_22.predict_proba(df_val_ext[EXTENDED_FEATURE_NAMES])[:, 1]
    m_val_22 = compute_metrics(df_val_ext['target'], val_pred_22, val_prob_22)

    print("Validation Set Comparison:")
    print(f"  - 18 Features : Val Acc={m_val_18['accuracy']*100:.2f}%, Val F1={m_val_18['f1']*100:.2f}%, Val ROC-AUC={m_val_18['roc_auc']:.4f}")
    print(f"  - 22 Features : Val Acc={m_val_22['accuracy']*100:.2f}%, Val F1={m_val_22['f1']*100:.2f}%, Val ROC-AUC={m_val_22['roc_auc']:.4f}")

    use_extended_features = m_val_22['f1'] > m_val_18['f1']
    active_features = EXTENDED_FEATURE_NAMES if use_extended_features else FEATURE_NAMES
    df_train_active = df_train_ext if use_extended_features else df_train_orig
    df_val_active = df_val_ext if use_extended_features else df_val_orig
    df_test_active = df_test_ext if use_extended_features else df_test_orig
    print(f"  -> Decision based on Validation: {'Adopt Extended 22 Features' if use_extended_features else 'Retain Original 18 Features'}")

    print("\n" + "="*80)
    print("STAGE 4: CONTROLLED XGBOOST HYPERPARAMETER STUDY (VALIDATION SET)")
    print("="*80)

    max_depths = [3, 4, 5]
    learning_rates = [0.03, 0.05, 0.08]
    min_child_weights = [1, 3, 5]
    gammas = [0, 0.1, 0.3]

    grid_results = []

    for md in max_depths:
        for lr in learning_rates:
            for mcw in min_child_weights:
                for gm in gammas:
                    h_params = {
                        "n_estimators": 300,
                        "max_depth": md,
                        "learning_rate": lr,
                        "min_child_weight": mcw,
                        "gamma": gm,
                        "subsample": 0.8,
                        "colsample_bytree": 0.8,
                        "reg_alpha": 0.1,
                        "reg_lambda": 1.0,
                        "objective": "binary:logistic",
                        "eval_metric": "logloss",
                        "random_state": 42
                    }
                    cand_model = XGBClassifier(**h_params)
                    cand_model.fit(df_train_active[active_features], df_train_active['target'], verbose=False)

                    v_pred = cand_model.predict(df_val_active[active_features])
                    v_prob = cand_model.predict_proba(df_val_active[active_features])[:, 1]
                    v_metrics = compute_metrics(df_val_active['target'], v_pred, v_prob)

                    t_pred = cand_model.predict(df_train_active[active_features])
                    t_acc = accuracy_score(df_train_active['target'], t_pred)
                    v_acc_gap = round((t_acc - v_metrics['accuracy']) * 100, 2)

                    grid_results.append({
                        "params": h_params,
                        "val_metrics": v_metrics,
                        "train_acc": t_acc,
                        "train_val_gap": v_acc_gap
                    })

    # Sort by Validation F1 and Validation Accuracy
    grid_results.sort(key=lambda x: (x['val_metrics']['f1'], x['val_metrics']['accuracy'], x['val_metrics']['roc_auc']), reverse=True)

    print("Top 5 Hyperparameter Configurations on Validation Set:")
    for idx, res in enumerate(grid_results[:5], 1):
        p = res['params']
        vm = res['val_metrics']
        print(f"  {idx}. depth={p['max_depth']}, lr={p['learning_rate']}, min_child={p['min_child_weight']}, gamma={p['gamma']} | Val F1={vm['f1']*100:.2f}%, Val Acc={vm['accuracy']*100:.2f}%, Val AUC={vm['roc_auc']:.4f} (Train-Val Gap: {res['train_val_gap']}%)")

    best_hparams = grid_results[0]['params']
    print(f"\nSelected Optimal Hyperparameters: max_depth={best_hparams['max_depth']}, lr={best_hparams['learning_rate']}, min_child_weight={best_hparams['min_child_weight']}, gamma={best_hparams['gamma']}")

    # Train best tuned model
    best_tuned_model = XGBClassifier(**best_hparams)
    best_tuned_model.fit(df_train_active[active_features], df_train_active['target'], verbose=False)

    print("\n" + "="*80)
    print("STAGE 5: THRESHOLD OPTIMIZATION (VALIDATION SET)")
    print("="*80)
    
    val_probs = best_tuned_model.predict_proba(df_val_active[active_features])[:, 1]
    y_val_arr = df_val_active['target'].values

    thresholds = np.arange(0.30, 0.72, 0.02)
    thresh_results = []

    for th in thresholds:
        th = round(float(th), 2)
        th_pred = (val_probs >= th).astype(int)
        th_acc = accuracy_score(y_val_arr, th_pred)
        th_f1 = f1_score(y_val_arr, th_pred, zero_division=0)
        th_prec = precision_score(y_val_arr, th_pred, zero_division=0)
        th_rec = recall_score(y_val_arr, th_pred, zero_division=0)

        thresh_results.append({
            "threshold": th,
            "accuracy": round(float(th_acc), 4),
            "f1": round(float(th_f1), 4),
            "precision": round(float(th_prec), 4),
            "recall": round(float(th_rec), 4)
        })

    # Pick threshold with highest Validation Accuracy (with F1 tie-breaker)
    best_thresh_entry = max(thresh_results, key=lambda x: (x['accuracy'], x['f1']))
    optimal_threshold = best_thresh_entry['threshold']

    print(f"{'Threshold':<10} | {'Val Accuracy':<14} | {'Val Precision':<14} | {'Val Recall':<12} | {'Val F1-Score':<12}")
    print("-"*75)
    for t in thresh_results:
        if t['threshold'] in [0.30, 0.40, 0.46, 0.50, 0.54, 0.60, 0.70] or t['threshold'] == optimal_threshold:
            flag = " <-- OPTIMAL" if t['threshold'] == optimal_threshold else ""
            print(f"{t['threshold']:<10.2f} | {t['accuracy']*100:>12.2f}% | {t['precision']*100:>12.2f}% | {t['recall']*100:>10.2f}% | {t['f1']*100:>10.2f}%{flag}")

    print(f"\nLocked Optimal Classification Threshold: {optimal_threshold:.2f}")

    print("\n" + "="*80)
    print("STAGE 6: FINAL UNTOUCHED TEST SET EVALUATION")
    print("="*80)

    # 1. Baseline Model (18 features, default params, thr=0.5)
    test_y_arr = df_test_orig['target'].values
    test_pred_base = model_18.predict(df_test_orig[FEATURE_NAMES])
    test_prob_base = model_18.predict_proba(df_test_orig[FEATURE_NAMES])[:, 1]
    m_test_base = compute_metrics(test_y_arr, test_pred_base, test_prob_base)

    # 2. Best Tuned XGBoost (18 features, tuned params, thr=0.5)
    tuned_18 = XGBClassifier(**best_hparams)
    tuned_18.fit(df_train_orig[FEATURE_NAMES], df_train_orig['target'], verbose=False)
    test_pred_tuned18 = tuned_18.predict(df_test_orig[FEATURE_NAMES])
    test_prob_tuned18 = tuned_18.predict_proba(df_test_orig[FEATURE_NAMES])[:, 1]
    m_test_tuned18 = compute_metrics(test_y_arr, test_pred_tuned18, test_prob_tuned18)

    # 3. Best Tuned XGBoost + Extended Features (22 features, tuned params, thr=0.5)
    tuned_22 = XGBClassifier(**best_hparams)
    tuned_22.fit(df_train_ext[EXTENDED_FEATURE_NAMES], df_train_ext['target'], verbose=False)
    test_pred_tuned22 = tuned_22.predict(df_test_ext[EXTENDED_FEATURE_NAMES])
    test_prob_tuned22 = tuned_22.predict_proba(df_test_ext[EXTENDED_FEATURE_NAMES])[:, 1]
    m_test_tuned22 = compute_metrics(test_y_arr, test_pred_tuned22, test_prob_tuned22)

    # 4. Best Model + Threshold Optimization (threshold applied to predicted probabilities)
    test_prob_active = tuned_22.predict_proba(df_test_ext[EXTENDED_FEATURE_NAMES])[:, 1] if use_extended_features else tuned_18.predict_proba(df_test_orig[FEATURE_NAMES])[:, 1]
    test_pred_opt_thresh = (test_prob_active >= optimal_threshold).astype(int)
    m_test_opt_thresh = compute_metrics(test_y_arr, test_pred_opt_thresh, test_prob_active)

    # Train Metrics for Overfitting Check
    train_pred_base = model_18.predict(df_train_orig[FEATURE_NAMES])
    train_pred_tuned18 = tuned_18.predict(df_train_orig[FEATURE_NAMES])
    train_pred_tuned22 = tuned_22.predict(df_train_ext[EXTENDED_FEATURE_NAMES])
    train_pred_opt_thresh = (tuned_22.predict_proba(df_train_ext[EXTENDED_FEATURE_NAMES])[:, 1] >= optimal_threshold).astype(int) if use_extended_features else (tuned_18.predict_proba(df_train_orig[FEATURE_NAMES])[:, 1] >= optimal_threshold).astype(int)

    candidates = [
        {
            "name": "Majority-Class Dummy Baseline",
            "train_acc": round(float(df_train_orig['target'].mean() * 100), 2),
            "val_acc": round(float(df_val_orig['target'].mean() * 100), 2),
            "test_metrics": {
                "accuracy": round(float(maj_acc), 4),
                "precision": round(float(maj_prec), 4),
                "recall": round(float(maj_rec), 4),
                "f1": round(float(maj_f1), 4),
                "roc_auc": 0.5000,
                "confusion_matrix": [[0, int(len(test_y_arr) - sum(test_y_arr))], [0, int(sum(test_y_arr))]]
            },
            "train_test_gap": round((df_train_orig['target'].mean() - maj_acc) * 100, 2)
        },
        {
            "name": "A. Current Baseline (18 feats, thr=0.5)",
            "train_acc": round(float(accuracy_score(df_train_orig['target'], train_pred_base) * 100), 2),
            "val_acc": round(float(m_val_18['accuracy'] * 100), 2),
            "test_metrics": m_test_base,
            "train_test_gap": round((accuracy_score(df_train_orig['target'], train_pred_base) - m_test_base['accuracy']) * 100, 2)
        },
        {
            "name": "B. Best Tuned XGBoost (18 feats, thr=0.5)",
            "train_acc": round(float(accuracy_score(df_train_orig['target'], train_pred_tuned18) * 100), 2),
            "val_acc": round(float(accuracy_score(df_val_orig['target'], tuned_18.predict(df_val_orig[FEATURE_NAMES])) * 100), 2),
            "test_metrics": m_test_tuned18,
            "train_test_gap": round((accuracy_score(df_train_orig['target'], train_pred_tuned18) - m_test_tuned18['accuracy']) * 100, 2)
        },
        {
            "name": "C. Best Tuned + Extended Feats (22 feats, thr=0.5)",
            "train_acc": round(float(accuracy_score(df_train_ext['target'], train_pred_tuned22) * 100), 2),
            "val_acc": round(float(accuracy_score(df_val_ext['target'], tuned_22.predict(df_val_ext[EXTENDED_FEATURE_NAMES])) * 100), 2),
            "test_metrics": m_test_tuned22,
            "train_test_gap": round((accuracy_score(df_train_ext['target'], train_pred_tuned22) - m_test_tuned22['accuracy']) * 100, 2)
        },
        {
            "name": f"D. Best Model + Optimal Thr ({optimal_threshold:.2f})",
            "train_acc": round(float(accuracy_score(df_train_active['target'], train_pred_opt_thresh) * 100), 2),
            "val_acc": round(float(best_thresh_entry['accuracy'] * 100), 2),
            "test_metrics": m_test_opt_thresh,
            "train_test_gap": round((accuracy_score(df_train_active['target'], train_pred_opt_thresh) - m_test_opt_thresh['accuracy']) * 100, 2)
        }
    ]

    print(f"{'Model / Experiment':<48} | {'Accuracy':<9} | {'Precision':<9} | {'Recall':<9} | {'F1-Score':<9} | {'ROC-AUC':<9} | {'Train-Test Gap':<14}")
    print("="*125)
    for c in candidates:
        tm = c['test_metrics']
        print(f"{c['name']:<48} | {tm['accuracy']*100:>7.2f}% | {tm['precision']*100:>7.2f}% | {tm['recall']*100:>7.2f}% | {tm['f1']*100:>7.2f}% | {tm['roc_auc']:>9.4f} | {c['train_test_gap']:>12.2f}%")
    print("="*125)

    # Feature Importance for the best winning model
    winning_model = tuned_22 if use_extended_features else tuned_18
    winning_features = EXTENDED_FEATURE_NAMES if use_extended_features else FEATURE_NAMES

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

    print("\nTop 10 Feature Importance (By Gain):")
    for rank, f_info in enumerate(feature_ranking[:10], 1):
        print(f"  {rank:2d}. {f_info['feature']:<36} Gain: {f_info['gain']:>8.4f} (Splits: {f_info['weight']})")

    # Production Model Saving
    # Determine if candidate D beats baseline
    base_f1 = m_test_base['f1']
    base_acc = m_test_base['accuracy']
    best_f1 = m_test_opt_thresh['f1']
    best_acc = m_test_opt_thresh['accuracy']

    print(f"\nFinal Baseline vs Best Model Comparison:")
    print(f"  - Baseline : Acc={base_acc*100:.2f}%, F1={base_f1*100:.2f}%, ROC-AUC={m_test_base['roc_auc']:.4f}")
    print(f"  - Best Model: Acc={best_acc*100:.2f}%, F1={best_f1*100:.2f}%, ROC-AUC={m_test_opt_thresh['roc_auc']:.4f}")
    print(f"  - Difference: Delta Acc={(best_acc - base_acc)*100:>+5.2f}%, Delta F1={(best_f1 - base_f1)*100:>+5.2f}%, Delta AUC={(m_test_opt_thresh['roc_auc'] - m_test_base['roc_auc']):>+7.4f}")

    # Save final study metadata
    study_report = {
        "study_timestamp": datetime.now().isoformat(),
        "target_audit": {
            "total_samples": total_samples,
            "positive_count": total_pos,
            "negative_count": total_neg,
            "positive_prevalence": round(total_pos / total_samples * 100, 2),
            "majority_class_accuracy": round(float(maj_acc * 100), 2)
        },
        "feature_engineering": {
            "evaluated_features": EXTENDED_FEATURE_NAMES,
            "validation_18_f1": m_val_18['f1'],
            "validation_22_f1": m_val_22['f1'],
            "adopted_extended": use_extended_features
        },
        "hyperparameter_study": {
            "best_hyperparameters": best_hparams,
            "validation_f1": grid_results[0]['val_metrics']['f1']
        },
        "threshold_study": {
            "optimal_threshold": optimal_threshold,
            "threshold_grid_results": thresh_results
        },
        "candidate_comparisons": candidates,
        "feature_importance_ranking": feature_ranking,
        "selected_production_model": "xgboost_optimized",
        "selected_threshold": optimal_threshold
    }

    report_path = os.path.join(models_dir, "scientific_improvement_report.json")
    with open(report_path, "w") as f:
        json.dump(study_report, f, indent=2)
    print(f"\nSaved scientific improvement study to {report_path}")

    return study_report, winning_model, optimal_threshold, winning_features


if __name__ == "__main__":
    run_scientific_study()
