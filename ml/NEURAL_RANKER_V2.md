# Donor Intelligence V2 — experimental MLP ranking

## Status and safety boundary

V2 is an experimental synthetic-data prototype. The existing Logistic Regression V1 /predict endpoint and artifact remain unchanged. V2 does not determine medical eligibility, authorize access to donor records, or dispatch donors. The Node.js backend remains responsible for tenant authorization, candidate retrieval, eligibility, availability, and dispatch decisions.

V2 returns an uncalibrated ranking utility, not a probability. The endpoint filters candidates unless verified, eligible, available, and blood-compatible flags are all true. The backend must independently enforce these constraints.

## Features

V2 reuses the 18 V1 dispatch-time features and adds distance_km, for 19 features total. Distance must be calculated by a trusted backend from authorized location data. Do not send donor names, email addresses, phone numbers, or other direct identifiers to the ML service.

## Train and evaluate

From repository root:

    python -m pip install -r ml/requirements.txt
    python ml/scripts/train_neural_ranker.py
    python ml/scripts/evaluate_neural_ranker.py
    pytest -q ml/tests/test_neural_ranker.py

Training creates ml/models/donor_ranker_mlp_v2.joblib and a sidecar metadata JSON. The artifact is not created during API startup. Configure LIFE_LINK_RANKER_MODEL_PATH if stored elsewhere.

The synthetic teacher is an invented demonstration rule. A model trained on it only demonstrates that training, serialization, validation and ranking inference work. It does not prove real donor-response prediction or improvement over V1.

## API

POST /rank accepts candidate IDs, distance_km, and the 18 numeric V1 features. Only candidates with verified, eligible, available and compatible flags set to 1 are scored. If no eligible candidates remain, the API returns an empty list. If the V2 artifact is absent, the endpoint returns 503 while V1 remains available.

Scores are utilities for ordering candidates only. Do not interpret them as probabilities or display them as percentages. Initially run V2 offline or in shadow mode.

## Promotion criteria

1. Keep V1 and a documented rules baseline.
2. Use scenario-grouped splits; for real outcomes also validate temporally and prevent donor leakage.
3. Evaluate NDCG@5, Precision@5, Recall@5, MRR, latency and hard-constraint violations.
4. Do not select V2 based on synthetic metrics.
5. Promote only after representative, appropriately governed historical outcomes show independently validated improvement and operational review approves the change.
