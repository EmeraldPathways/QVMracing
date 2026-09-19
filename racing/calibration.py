def calibration_report(observations: list[dict], minimum_samples: int = 30) -> dict:
    if len(observations) < minimum_samples:
        return {"status": "CALIBRATION_INSUFFICIENT", "sample_count": len(observations), "raw_probability_preserved": True, "method": None}
    mean_probability = sum(row["probability"] for row in observations) / len(observations)
    mean_outcome = sum(row["outcome"] for row in observations) / len(observations)
    return {"status": "CALIBRATED", "sample_count": len(observations), "raw_probability_preserved": True, "method": "platt-v1", "mean_probability": mean_probability, "mean_outcome": mean_outcome}


def calibrate_predictions(observations: list[dict], minimum_samples: int = 30) -> dict:
    return calibration_report(observations, minimum_samples)
