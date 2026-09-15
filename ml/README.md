# LIFE-LINK ML: Donor Dispatch Response Prediction Pipeline

Production-ready machine learning pipeline for predicting whether a dispatched blood donor will respond positively (`ACCEPTED` / `COMPLETED`) to an emergency blood request in the **LIFE-LINK** emergency medical resource network.

---

## 1. System Architecture

```
ml/
├── data/
│   ├── raw/                 # Ingested Supabase / synthetic raw tables
│   └── processed/           # Group-aware train/val/test CSV partitions
├── models/
│   ├── donor_response_xgb_baseline.json   # Trained Baseline XGBoost
│   ├── donor_response_xgb_hem.json        # Trained Hard Example Mining XGBoost
│   └── model_metadata.json                # Complete metrics, feature order & metadata
├── scripts/
│   ├── fetch_data.py               # Supabase ETL with zero-leakage fallback
│   ├── generate_synthetic_data.py  # Clinically grounded synthetic generator
│   ├── feature_engineering.py      # 18 feature extractors & GroupShuffleSplit
│   ├── train_baseline.py           # Regularized baseline XGBoost trainer
│   ├── train_hem.py                # Dual-signal HEM weighting & trainer
│   └── evaluate.py                 # Untouched test set evaluation & analysis
├── api/
│   └── main.py              # Production FastAPI inference service
├── tests/
│   └── test_api.py          # Pytest suite for validation & endpoints
├── requirements.txt         # Pinned production dependencies
├── railway.json             # Railway deployment configuration
├── Procfile                 # Process launcher
├── .env.example             # Environment variable template
└── README.md
```

---

## 2. The 18 Domain Features & Zero-Leakage Guarantee

All 18 features are known strictly at dispatch time. Outcome information (`responded_at`, `accepted_at`, `completed_at`, post-acceptance live location, and post-outcome ETA) are strictly excluded from the feature space.

| # | Feature Name | Type | Definition / Leakage Safeguard |
|---|---|---|---|
| 1 | `is_exact_blood_match` | `int` (0/1) | 1 if donor blood type exactly matches emergency request |
| 2 | `is_blood_compatible` | `int` (0/1) | 1 if donor red cells are compatible with recipient |
| 3 | `is_universal_donor` | `int` (0/1) | 1 if donor is O-negative |
| 4 | `donor_is_verified` | `int` (0/1) | 1 if donor identity/medical credentials are verified |
| 5 | `donor_is_eligible` | `int` (0/1) | 1 if donor meets donation cooldown and medical eligibility |
| 6 | `donor_is_available` | `int` (0/1) | 1 if donor is marked available at dispatch time |
| 7 | `donor_response_rate` | `float` [0.0 - 1.0] | **Strict historical calculation over previous dispatches 1..k-1** |
| 8 | `donor_history_count` | `int` | **Total dispatches received by this donor prior to this dispatch** |
| 9 | `donor_positive_responses`| `int` | **Total positive responses given by this donor prior to this dispatch**|
| 10 | `days_since_last_donation`| `float` | Days between dispatch and donor's last donation date |
| 11 | `dispatch_hour` | `int` (0-23) | Hour of the day when dispatch was sent |
| 12 | `dispatch_day_of_week` | `int` (0-6) | Day of the week (0=Monday, 6=Sunday) |
| 13 | `is_weekend` | `int` (0/1) | 1 if Saturday or Sunday |
| 14 | `is_night_dispatch` | `int` (0/1) | 1 if dispatched between 22:00 and 06:00 |
| 15 | `is_business_hours` | `int` (0/1) | 1 if dispatched during weekday working hours (09:00 - 18:00) |
| 16 | `requested_quantity` | `float` | Blood units requested in emergency request |
| 17 | `urgency_level` | `int` (0-3) | 3: Critical, 2: High, 1: Medium, 0: Low |
| 18 | `is_resource_blood` | `int` (0/1) | 1 if resource is whole blood / RBC, 0 for platelets/plasma |

---

## 3. Installation & Quick Start

### Step 1: Install Dependencies
```bash
pip install -r ml/requirements.txt
```

### Step 2: Configure Environment (Optional for Supabase)
```bash
cp ml/.env.example ml/.env
```

### Step 3: Run Training & Evaluation Pipeline
```bash
python ml/scripts/evaluate.py
```

### Step 4: Run FastAPI Inference Service
```bash
uvicorn ml.api.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive API documentation available at: `http://localhost:8000/docs`

---

## 4. Model Evaluation & Research Comparison

### Untouched Test Set Evaluation (553 Samples, 68 unseen donors)

| Model | Accuracy | Precision | Recall | F1-Score | ROC-AUC |
|---|---|---|---|---|---|
| **Baseline XGBoost** | **72.88%** | **76.54%** | **89.03%** | **82.31%** | **0.7237** |
| **XGBoost + HEM** | 69.80% | 76.35% | 83.16% | 79.61% | 0.7026 |
| **Absolute Difference ($\Delta$)** | -3.08% | -0.19% | -5.87% | -2.70% | -0.0211 |
| **Relative Difference (%)** | -4.23% | -0.25% | -6.59% | -3.28% | -2.92% |

### Overfitting & Generalization Analysis
- **Baseline XGBoost**: Train Accuracy: 85.72% | Test Accuracy: 72.88% | **Train-Test Gap: 12.84%**
- **XGBoost + HEM**: Train Accuracy: 91.55% | Test Accuracy: 69.80% | **Train-Test Gap: 21.75%**

**Finding**: Hard Example Mining achieved higher training accuracy (91.55% vs 85.72%) by heavily up-weighting borderline and noisy examples (weight 3.0), which amplified label noise and caused overfitting on unseen donors. Therefore, the pipeline automatically selects `xgb_baseline` for production deployment to maximize real-world generalization.

---

## 5. Hard Example Mining (HEM) Statistics (Training Set: 2,486 Samples)

- **Misclassified Samples**: 355
- **Uncertain Samples ($|p - 0.5| < 0.15$)**: 487
- **Very Hard Samples (Misclassified & Uncertain)**: 201 (Weight = 3.0)
- **Hard Samples (Misclassified or Uncertain)**: 440 (Weight = 2.0)
- **Normal Samples**: 1,845 (Weight = 1.0)

---

## 6. Top 10 Predictive Features (By Information Gain)

1. `is_exact_blood_match` (Gain: 9.9588)
2. `is_blood_compatible` (Gain: 7.9058)
3. `donor_is_available` (Gain: 6.0444)
4. `donor_is_eligible` (Gain: 4.9719)
5. `donor_is_verified` (Gain: 4.4804)
6. `dispatch_hour` (Gain: 4.2968)
7. `is_business_hours` (Gain: 4.2114)
8. `days_since_last_donation` (Gain: 4.0258)
9. `requested_quantity` (Gain: 3.9860)
10. `donor_response_rate` (Gain: 3.8936)

---

## 7. API Reference: `POST /predict`

### Example Request (cURL)
```bash
curl -X POST "http://localhost:8000/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "is_exact_blood_match": 1,
    "is_blood_compatible": 1,
    "is_universal_donor": 0,
    "donor_is_verified": 1,
    "donor_is_eligible": 1,
    "donor_is_available": 1,
    "donor_response_rate": 0.85,
    "donor_history_count": 12,
    "donor_positive_responses": 10,
    "days_since_last_donation": 110.0,
    "dispatch_hour": 14,
    "dispatch_day_of_week": 2,
    "is_weekend": 0,
    "is_night_dispatch": 0,
    "is_business_hours": 1,
    "requested_quantity": 2.0,
    "urgency_level": 3,
    "is_resource_blood": 1
  }'
```

### Example Response
```json
{
  "prediction": 1,
  "probability": 0.8732,
  "model": "xgb_baseline"
}
```
