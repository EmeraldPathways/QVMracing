def worker_report(*, source_counts: dict, quote_ages: list[float], model_version: str, candidates: list[dict], errors: list[str] | None = None) -> dict:
    return {"role": "WORKER", "sourceCounts": source_counts, "quoteAges": quote_ages, "modelVersion": model_version, "candidates": candidates, "errors": errors or []}


def manager_report(candidates: list[dict]) -> dict:
    return {"role": "MANAGER", "rankedCandidates": sorted([c for c in candidates if c.get("action") == "PAPER_CANDIDATE"], key=lambda c: c.get("edge", 0), reverse=True)}


def auditor_report(candidates: list[dict]) -> dict:
    vetoes = [c.get("reasonCode") for c in candidates if c.get("action") in {"ABSTAIN", "BLOCKED"}]
    return {"role": "AUDITOR", "approved": not any(vetoes), "vetoReasons": [v for v in vetoes if v]}
