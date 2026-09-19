from dataclasses import dataclass
from math import exp, log


@dataclass(frozen=True)
class ModelPrediction:
    runner_id: str
    probability: float
    fair_odds: float


def no_vig_probabilities(odds: dict[str, float]) -> dict[str, float]:
    if not odds or any(float(price) <= 1 for price in odds.values()):
        raise ValueError("odds must be greater than 1")
    raw = {runner_id: 1 / float(price) for runner_id, price in odds.items()}
    total = sum(raw.values())
    return {runner_id: probability / total for runner_id, probability in raw.items()}


def predict_race(runners: list[dict], features: dict[str, dict], market_odds: dict[str, float]) -> list[ModelPrediction]:
    active = [runner for runner in runners if runner.get("declarationStatus", "DECLARED") not in {"WITHDRAWN", "NON_RUNNER", "SCRATCHED"}]
    market = no_vig_probabilities({runner["id"]: market_odds[runner["id"]] for runner in active})
    utilities = {}
    for runner in active:
        feature = features.get(runner["id"], {})
        utilities[runner["id"]] = 0.035 * float(feature.get("rating", 0)) + 0.30 * log(market[runner["id"]])
    maximum = max(utilities.values())
    weights = {runner_id: exp(value - maximum) for runner_id, value in utilities.items()}
    total = sum(weights.values())
    return [ModelPrediction(runner_id, weights[runner_id] / total, 1 / (weights[runner_id] / total)) for runner_id in utilities]
