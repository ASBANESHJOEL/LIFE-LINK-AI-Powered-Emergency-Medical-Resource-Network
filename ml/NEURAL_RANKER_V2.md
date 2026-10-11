# Donor Intelligence V2 — experimental MLP ranking

## Status and safety boundary

V2 is an experimental synthetic-data prototype. Logistic Regression V1 /predict and its artifact remain unchanged. V2 does not determine medical eligibility or authorize access. The Express backend performs tenant authorization, obtains eligible candidates, computes features from authorized records, and rechecks dispatch constraints.

V2 returns an uncalibrated ranking utility, not a probability. The FastAPI /rank endpoint requires Authorization: Bearer <ML_RANKING_API_KEY>. Configure the same random secret in the backend and ML service. Ranking is disabled by default with ML_RANKING_ENABLED=false.

## Features

V2 reuses the 18 V1 dispatch-time features and adds distance_km. The backend calculates distance from request and donor coordinates and derives historical response features only from dispatches created before the request timestamp. Direct donor identifiers and contact details are not sent to the model; donor_id is returned only as an opaque correlation value.

## Train and evaluate

From repository root:

    python -m pip install -r ml/requirements.txt
    python ml/scripts/train_neural_ranker.py
    python ml/scripts/evaluate_neural_ranker.py
    pytest -q ml/tests/test_neural_ranker.py ml/tests/test_neural_ranker_api.py
    npm --prefix backend test

Training creates ml/models/donor_ranker_mlp_v2.joblib and a sidecar metadata JSON. The artifact is not created during API startup. Configure LIFE_LINK_RANKER_MODEL_PATH if stored elsewhere. Ranking returns 503 until the artifact and API key are configured; V1 remains available.

The synthetic teacher is an invented demonstration rule. A model trained on it demonstrates training, serialization, validation and ranking inference only. It does not prove real donor-response prediction or improvement over V1.

## Promotion criteria

Keep V1 and a documented rules baseline. Use scenario-grouped splits; for real outcomes also validate temporally and prevent donor leakage. Evaluate NDCG@5, Precision@5, Recall@5, MRR, latency and hard-constraint violations. Do not select V2 based on synthetic metrics. Promote only after representative, appropriately governed historical outcomes show independently validated improvement and operational review approves the change.
