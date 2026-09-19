def calculate_metrics(observations: list[dict]) -> dict:
    if not observations:
        return {"sample_count": 0, "log_loss": None, "brier_score": None, "net_paper_pnl": 0, "turnover": 0}
    import math
    brier = sum((row["probability"] - row["outcome"]) ** 2 for row in observations) / len(observations)
    log_loss = sum(-math.log(max(1e-12, row["probability"] if row["outcome"] else 1 - row["probability"])) for row in observations) / len(observations)
    return {"sample_count": len(observations), "log_loss": log_loss, "brier_score": brier, "net_paper_pnl": sum(row.get("pnl", 0) for row in observations), "turnover": sum(row.get("stake", 0) for row in observations)}


def calculate_calibration_metrics(observations: list[dict]) -> dict:
    report = calculate_metrics(observations)
    report["expected_calibration_error"] = 0.0 if not observations else abs(sum(x["probability"] for x in observations) / len(observations) - sum(x["outcome"] for x in observations) / len(observations))
    return report


def calculate_paper_performance(observations: list[dict]) -> dict:
    report = calculate_metrics(observations)
    report["roi"] = report["net_paper_pnl"] / report["turnover"] if report["turnover"] else 0.0
    return report
