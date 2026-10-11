"""Evaluate V2 on fresh held-out synthetic scenarios only."""
import json
import os
import sys

ML_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)
from scripts.neural_ranker import load_neural_ranker
from scripts.train_neural_ranker import generate_synthetic_scenarios, grouped_ndcg, split_by_scenario


def evaluate():
    artifact = load_neural_ranker()
    data = generate_synthetic_scenarios(seed=123)
    _, _, test = split_by_scenario(data, seed=123)
    scores = artifact["model"].predict(test[artifact["feature_names"]])
    teacher = test["target_utility"].to_numpy()
    result = {
        "dataset": "synthetic_only", "model_version": artifact["model_version"],
        "candidate_count": int(len(test)), "scenario_count": int(test.scenario_id.nunique()),
        "mlp_ndcg_at_5": round(grouped_ndcg(test, scores), 4),
        "synthetic_teacher_ndcg_at_5": round(grouped_ndcg(test, teacher), 4),
        "interpretation": "Pipeline sanity check only. Synthetic teacher defines labels; no real-world performance claim is supported.",
    }
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    evaluate()
