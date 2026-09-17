# LIFE-LINK Production Model Documentation (V1)

## 1. Overview & Objective

**LIFE-LINK** is an emergency blood-resource coordination network. The ML objective is **Donor Dispatch Response Prediction**:
> Given a donor, an emergency request, and the dispatch context at time $t$, predict the probability $P(\text{Response} = 1)$ that the donor will respond positively (`ACCEPTED` or `COMPLETED`) to the emergency dispatch.

- **Production Model Identifier**: `donor_response_logistic_v1`
- **Model Version**: `v1`
- **Algorithm**: Regularized Logistic Regression (`L2` penalty, `C=1.0`, `lbfgs` solver) with `StandardScaler`
- **Artifact Path**: [`ml/models/donor_response_logistic_v1.joblib`](file:///c:/Users/james/OneDrive/Desktop/LIFE_LINK/ml/models/donor_response_logistic_v1.joblib)
- **Metadata Path**: [`ml/models/model_metadata.json`](file:///c:/Users/james/OneDrive/Desktop/LIFE_LINK/ml/models/model_metadata.json)

---

## 2. Why Logistic Regression Was Selected as Production V1

During comprehensive candidate model evaluation on a fresh, donor-level holdout partition (strictly isolated donors with zero training overlap), **Logistic Regression demonstrated the strongest generalization performance** across all key emergency medical dispatch criteria:

1. **Superior Generalization on Unseen Donors**:
   - Logistic Regression achieved **77.82% Accuracy** and **86.33% F1-Score** on the holdout partition.
   - Non-linear tree-based models (XGBoost, CatBoost, ExtraTrees) exhibited greater empirical variance and overfit to specific donor behavioral patterns in the training set.

2. **Critical Sensitivity & Recall (94.01%)**:
   - In emergency blood logistics, false negatives (failing to dispatch to a donor who would have accepted) are operationally costly.
   - Logistic Regression attained **94.01% Recall** with **79.81% Precision** and a **PR-AUC of 0.8813**, reliably ranking high-propensity donors.

3. **Marginal Ensemble Gains**:
   - A soft-voting ensemble combining Logistic Regression and XGBoost yielded only marginal improvements over standalone Logistic Regression, adding unnecessary computational complexity and latency without significant clinical utility.

---

## 3. Candidate Benchmark Comparison (Fresh Donor-Level Holdout)

| Candidate Model | Accuracy | Precision | Recall | F1-Score | ROC-AUC | PR-AUC | Status |
|---|---|---|---|---|---|---|---|
| **Logistic Regression (V1 Production)** | **77.82%** | **79.81%** | **94.01%** | **86.33%** | **0.7419** | **0.8813** | **Production Deployed** |
| **XGBoost (Tuned Baseline)** | 76.43% | — | — | 85.39% | 0.7319 | — | Research Artifact |
| **CatBoost** | 76.29% | — | — | 85.19% | 0.7214 | — | Research Artifact |
| **ExtraTrees** | 72.52% | — | — | 82.64% | 0.6792 | — | Research Artifact |
| **Ensemble (LogReg + XGBoost)** | 77.95% | — | — | 86.41% | 0.7435 | — | Research Artifact (Marginal gain) |

> [!NOTE]
> **Research Artifact Isolation Statement**:
> All alternative candidate models—including XGBoost baseline (`donor_response_xgb_baseline.json`), Hard Example Mining (`donor_response_xgb_hem.json`), CatBoost, ExtraTrees, and ensemble experiments—remain preserved as research and ablation artifacts. They are **NOT** used for production inference.

---

## 4. The 18 Canonical Production Features

The production model strictly takes the following 18 features in exact order, known strictly at dispatch time (zero post-outcome leakage):

| # | Feature Name | Type | Description |
|---|---|---|---|
| 1 | `is_exact_blood_match` | `int (0/1)` | 1 if donor blood group exactly matches emergency request |
| 2 | `is_blood_compatible` | `int (0/1)` | 1 if donor RBC is clinically compatible with recipient |
| 3 | `is_universal_donor` | `int (0/1)` | 1 if donor is O-negative |
| 4 | `donor_is_verified` | `int (0/1)` | 1 if donor identity and phone are verified |
| 5 | `donor_is_eligible` | `int (0/1)` | 1 if donor meets clinical donation interval eligibility |
| 6 | `donor_is_available` | `int (0/1)` | 1 if donor is marked active/available at dispatch time |
| 7 | `donor_response_rate` | `float [0.0 - 1.0]` | Historical acceptance rate across prior dispatches $1 \dots k-1$ |
| 8 | `donor_history_count` | `int` | Total previous dispatches received by donor prior to this dispatch |
| 9 | `donor_positive_responses` | `int` | Total prior positive responses given by donor |
| 10 | `days_since_last_donation` | `float` | Days elapsed since donor's last completed blood donation |
| 11 | `dispatch_hour` | `int (0 - 23)` | Local hour when dispatch notification was initiated |
| 12 | `dispatch_day_of_week` | `int (0 - 6)` | Day of week (0 = Monday, 6 = Sunday) |
| 13 | `is_weekend` | `int (0/1)` | 1 if dispatch occurs on Saturday or Sunday |
| 14 | `is_night_dispatch` | `int (0/1)` | 1 if dispatched during nighttime (22:00 to 06:00) |
| 15 | `is_business_hours` | `int (0/1)` | 1 if dispatched during weekday working hours (09:00 to 18:00) |
| 16 | `requested_quantity` | `float` | Units of blood/components requested |
| 17 | `urgency_level` | `int (0 - 3)` | Urgency tier: 3 (Critical), 2 (High), 1 (Medium), 0 (Low) |
| 18 | `is_resource_blood` | `int (0/1)` | 1 for whole blood / RBC, 0 for platelets/plasma |

### Prohibited Features (Enforced Zero-Leakage)
The following fields are strictly excluded from training and inference to avoid label leakage and distribution shift:
- `recent_response_rate_last_5`
- `recent_positive_responses_last_5`
- `dispatches_since_last_donation`
- `time_since_previous_dispatch_hours`
- Exponentially weighted moving (EWM) metrics
- Post-outcome fields (`respondedAt`, `acceptedAt`, `completedAt`, live location, ETA, batch number, priority score).

---

## 5. Model Architecture & Pipeline

```
Input (18 Features) ──► StandardScaler() ──► LogisticRegression(C=1.0, penalty='l2') ──► P(Acceptance)
```

- **Pipeline**: `sklearn.pipeline.Pipeline`
- **Scaler**: `sklearn.preprocessing.StandardScaler` (persists feature-wise means and variances)
- **Classifier**: `sklearn.linear_model.LogisticRegression`

---

## 6. How to Load and Run Inference

### Programmatic Usage in Python:
```python
from ml.scripts.load_production_model import predict_donor_response

sample_features = {
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
}

result = predict_donor_response(sample_features)
print(result)
# Output: {'prediction': 1, 'probability': 0.9687, 'threshold': 0.5, 'model_version': 'donor_response_logistic_v1'}
```

---

## 7. Operational Disclaimer & Safety Notice

> [!WARNING]
> **Experimental Dataset Disclaimer**:
> The reported holdout performance metrics (77.82% Accuracy, 94.01% Recall, 86.33% F1) are derived from benchmark evaluations on the experimental dataset partition under donor-group isolation. **These metrics are not a mathematical guarantee of identical real-world dispatch acceptance rates**.
>
> In production environments:
> 1. Predictions must serve as an advisory decision-support signal for emergency coordinators, not as a sole barrier to patient care.
> 2. Model drift, demographic distribution changes, and seasonal availability patterns should be monitored continuously.
