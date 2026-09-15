"""
LIFE-LINK Feature Engineering & Dataset Preparation
Constructs the 18 approved domain features from raw Supabase tables.

Guarantees:
1. Strict zero-target-leakage historical calculation (dispatches 1..k-1 used for dispatch k)
2. Post-acceptance fields completely isolated
3. Group-aware train/val/test splitting by donor_id to prevent donor leakage
4. Exact feature ordering preserved
"""

import os
import sys
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.model_selection import GroupShuffleSplit

# Exact 18 Feature Order
FEATURE_NAMES = [
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

RBC_COMPATIBILITY = {
    'O-': {'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'},
    'O+': {'O+', 'A+', 'B+', 'AB+'},
    'A-': {'A-', 'A+', 'AB-', 'AB+'},
    'A+': {'A+', 'AB+'},
    'B-': {'B-', 'B+', 'AB-', 'AB+'},
    'B+': {'B+', 'AB+'},
    'AB-': {'AB-', 'AB+'},
    'AB+': {'AB+'}
}

URGENCY_MAP = {
    'LOW': 0,
    'MEDIUM': 1,
    'HIGH': 2,
    'CRITICAL': 3,
    0: 0, 1: 1, 2: 2, 3: 3
}


def compute_blood_compatibility(donor_blood: str, req_blood: str) -> bool:
    donor_clean = str(donor_blood).strip().upper()
    req_clean = str(req_blood).strip().upper()
    return req_clean in RBC_COMPATIBILITY.get(donor_clean, set())


def build_ml_dataset(
    raw_dir: str = "ml/data/raw",
    processed_dir: str = "ml/data/processed",
    random_state: int = 42
):
    os.makedirs(processed_dir, exist_ok=True)
    
    donors_path = os.path.join(raw_dir, "donors.csv")
    requests_path = os.path.join(raw_dir, "emergency_requests.csv")
    dispatches_path = os.path.join(raw_dir, "donor_dispatches.csv")

    if not os.path.exists(donors_path) or not os.path.exists(requests_path) or not os.path.exists(dispatches_path):
        from fetch_data import fetch_from_supabase
        fetch_from_supabase(output_dir=raw_dir)

    df_donors = pd.read_csv(donors_path)
    df_requests = pd.read_csv(requests_path)
    df_dispatches = pd.read_csv(dispatches_path)

    # Normalize column names
    df_donors.columns = [c.lower() for c in df_donors.columns]
    df_requests.columns = [c.lower() for c in df_requests.columns]
    df_dispatches.columns = [c.lower() for c in df_dispatches.columns]

    # Clean IDs
    df_donors['id'] = df_donors['id'].astype(str)
    df_requests['id'] = df_requests['id'].astype(str)
    df_dispatches['donor_id'] = df_dispatches['donor_id'].astype(str)
    df_dispatches['request_id'] = df_dispatches['request_id'].astype(str)

    # Construct Target from outcome status
    # ACCEPTED / COMPLETED -> 1 (Positive response)
    # DECLINED / NO_RESPONSE / MISSED / EXPIRED / CANCELLED -> 0 (Negative response)
    status_series = df_dispatches['status'].astype(str).str.upper()
    df_dispatches['target'] = status_series.isin(['ACCEPTED', 'COMPLETED']).astype(int)

    # Convert dispatch timestamp
    disp_time_col = 'dispatched_at' if 'dispatched_at' in df_dispatches.columns else 'created_at'
    df_dispatches['dispatch_dt'] = pd.to_datetime(df_dispatches[disp_time_col])

    # Sort strictly chronologically by dispatch time to enforce zero historical leakage
    df_dispatches = df_dispatches.sort_values(by=['dispatch_dt', 'id']).reset_index(drop=True)

    # =========================================================================
    # STRICT HISTORICAL FEATURE CALCULATION (Per-Donor Chronological Roll)
    # For dispatch k, history is strictly over indices 0..(k-1)
    # =========================================================================
    history_counts = []
    positive_counts = []
    response_rates = []

    donor_history_tracker = {}  # donor_id -> list of prior outcomes [1, 0, 1...]

    for _, row in df_dispatches.iterrows():
        donor_id = row['donor_id']
        current_target = row['target']

        prior_outcomes = donor_history_tracker.get(donor_id, [])
        h_count = len(prior_outcomes)
        p_count = sum(prior_outcomes)
        r_rate = (p_count / h_count) if h_count > 0 else 0.0

        history_counts.append(h_count)
        positive_counts.append(p_count)
        response_rates.append(round(r_rate, 4))

        # Update tracker AFTER recording features for the current row
        if donor_id not in donor_history_tracker:
            donor_history_tracker[donor_id] = []
        donor_history_tracker[donor_id].append(current_target)

    df_dispatches['donor_history_count'] = history_counts
    df_dispatches['donor_positive_responses'] = positive_counts
    df_dispatches['donor_response_rate'] = response_rates

    # Join with Donors table
    donors_lookup = df_donors.set_index('id').to_dict(orient='index')
    
    # Join with Emergency Requests table
    requests_lookup = df_requests.set_index('id').to_dict(orient='index')

    rows = []
    skipped_count = 0

    for _, disp in df_dispatches.iterrows():
        donor_id = disp['donor_id']
        req_id = disp['request_id']

        if donor_id not in donors_lookup or req_id not in requests_lookup:
            skipped_count += 1
            continue

        donor = donors_lookup[donor_id]
        req = requests_lookup[req_id]
        dt = disp['dispatch_dt']

        # 1. is_exact_blood_match
        donor_blood = str(donor.get('blood_type', '')).strip().upper()
        req_blood = str(req.get('blood_type', '')).strip().upper()
        is_exact = 1 if (donor_blood and req_blood and donor_blood == req_blood) else 0

        # 2. is_blood_compatible
        is_compat = 1 if compute_blood_compatibility(donor_blood, req_blood) else 0

        # 3. is_universal_donor (O-)
        is_univ = 1 if donor_blood == 'O-' else 0

        # 4. donor_is_verified
        donor_ver = 1 if donor.get('is_verified', True) in [True, 1, 'true', 't', '1'] else 0

        # 5. donor_is_eligible
        donor_elig = 1 if donor.get('is_eligible', True) in [True, 1, 'true', 't', '1'] else 0

        # 6. donor_is_available
        donor_avail = 1 if donor.get('is_available', True) in [True, 1, 'true', 't', '1'] else 0

        # 7, 8, 9. Historical features (computed above without leakage)
        d_resp_rate = disp['donor_response_rate']
        d_hist_count = disp['donor_history_count']
        d_pos_resp = disp['donor_positive_responses']

        # 10. days_since_last_donation
        last_don_val = donor.get('last_donation_date')
        if pd.notna(last_don_val) and str(last_don_val).strip() != '':
            try:
                last_don_dt = pd.to_datetime(last_don_val)
                days_since = max(0, (dt - last_don_dt).days)
            except Exception:
                days_since = 365.0
        else:
            days_since = 365.0  # Clean default imputation for first-time donors

        # 11. dispatch_hour
        d_hour = dt.hour

        # 12. dispatch_day_of_week
        d_dow = dt.weekday()

        # 13. is_weekend
        is_wknd = 1 if d_dow in [5, 6] else 0

        # 14. is_night_dispatch (22:00 to 06:00)
        is_night = 1 if (d_hour >= 22 or d_hour < 6) else 0

        # 15. is_business_hours (09:00 to 18:00 on weekdays)
        is_biz = 1 if (9 <= d_hour < 18 and not is_wknd) else 0

        # 16. requested_quantity
        req_qty = float(req.get('requested_quantity', req.get('quantity', 1.0)) or 1.0)

        # 17. urgency_level
        urg_val = req.get('urgency_level', req.get('urgency', 'MEDIUM'))
        urg_mapped = URGENCY_MAP.get(str(urg_val).strip().upper(), 1) if isinstance(urg_val, str) else int(urg_val)

        # 18. is_resource_blood
        res_type = str(req.get('resource_type', 'BLOOD')).strip().upper()
        is_res_blood = 1 if ('BLOOD' in res_type or 'RBC' in res_type) else 0

        row_dict = {
            "dispatch_id": disp['id'],
            "donor_id": donor_id,
            "request_id": req_id,
            "dispatched_at": disp['dispatched_at'] if 'dispatched_at' in disp else str(dt),
            "target": disp['target'],
            "is_exact_blood_match": is_exact,
            "is_blood_compatible": is_compat,
            "is_universal_donor": is_univ,
            "donor_is_verified": donor_ver,
            "donor_is_eligible": donor_elig,
            "donor_is_available": donor_avail,
            "donor_response_rate": d_resp_rate,
            "donor_history_count": d_hist_count,
            "donor_positive_responses": d_pos_resp,
            "days_since_last_donation": float(days_since),
            "dispatch_hour": int(d_hour),
            "dispatch_day_of_week": int(d_dow),
            "is_weekend": is_wknd,
            "is_night_dispatch": is_night,
            "is_business_hours": is_biz,
            "requested_quantity": float(req_qty),
            "urgency_level": int(urg_mapped),
            "is_resource_blood": is_res_blood
        }
        rows.append(row_dict)

    df_ml = pd.DataFrame(rows)
    print(f"[feature_engineering] Total processed rows: {len(df_ml)} (Skipped invalid relations: {skipped_count})")

    # =========================================================================
    # GROUP-AWARE TRAIN / VAL / TEST SPLIT
    # Grouped by donor_id to guarantee zero donor identity leakage
    # 70% Train, 15% Validation, 15% Untouched Test
    # =========================================================================
    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=random_state)
    train_val_idx, test_idx = next(gss_test.split(df_ml, df_ml['target'], groups=df_ml['donor_id']))

    df_train_val = df_ml.iloc[train_val_idx].reset_index(drop=True)
    df_test = df_ml.iloc[test_idx].reset_index(drop=True)

    # Split train_val into 82.35% train and 17.65% val (approx 70% train / 15% val overall)
    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.1765, random_state=random_state)
    train_idx, val_idx = next(gss_val.split(df_train_val, df_train_val['target'], groups=df_train_val['donor_id']))

    df_train = df_train_val.iloc[train_idx].reset_index(drop=True)
    df_val = df_train_val.iloc[val_idx].reset_index(drop=True)

    # Save datasets
    df_ml.to_csv(os.path.join(processed_dir, "dataset_full.csv"), index=False)
    df_train.to_csv(os.path.join(processed_dir, "train.csv"), index=False)
    df_val.to_csv(os.path.join(processed_dir, "val.csv"), index=False)
    df_test.to_csv(os.path.join(processed_dir, "test.csv"), index=False)

    print(f"[feature_engineering] Dataset Splits (Grouped by donor_id):")
    print(f"  - Full Dataset : {len(df_ml)} samples | Positive: {df_ml['target'].sum()} ({df_ml['target'].mean()*100:.2f}%)")
    print(f"  - Train Set    : {len(df_train)} samples ({len(df_train)/len(df_ml)*100:.1f}%) | Donors: {df_train['donor_id'].nunique()}")
    print(f"  - Val Set      : {len(df_val)} samples ({len(df_val)/len(df_ml)*100:.1f}%) | Donors: {df_val['donor_id'].nunique()}")
    print(f"  - Test Set     : {len(df_test)} samples ({len(df_test)/len(df_ml)*100:.1f}%) | Donors: {df_test['donor_id'].nunique()}")

    # Assert no donor overlap between train, val, test
    train_donors = set(df_train['donor_id'])
    val_donors = set(df_val['donor_id'])
    test_donors = set(df_test['donor_id'])
    assert len(train_donors.intersection(test_donors)) == 0, "FATAL: Donor leakage detected between Train and Test!"
    assert len(train_donors.intersection(val_donors)) == 0, "FATAL: Donor leakage detected between Train and Val!"
    assert len(val_donors.intersection(test_donors)) == 0, "FATAL: Donor leakage detected between Val and Test!"
    print("[feature_engineering] PASS: Zero donor overlap verified across all splits.")

    return df_train, df_val, df_test, FEATURE_NAMES


if __name__ == "__main__":
    build_ml_dataset()
