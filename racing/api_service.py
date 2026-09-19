from datetime import datetime, timezone
from uuid import uuid4

from .metrics import calculate_metrics
from .sync import SyncStore


class RacingApiService:
    def __init__(self):
        self.stale = False
        self.positions = []
        self.sync_store = SyncStore()

    def overview(self) -> dict:
        return {"provider": "demo", "modelVersion": "racing-logit-v1", "paperOnly": True, "openPositions": len([p for p in self.positions if p["status"] == "OPEN"]), "heartbeat": {"status": "READY"}}

    def scan(self) -> dict:
        return {"modelVersion": "racing-logit-v1", "candidates": [{"runnerId": "demo:horse:1", "action": "PAPER_CANDIDATE", "edge": .172, "quoteAgeSeconds": 24, "dataQuality": 95}, {"runnerId": "demo:horse:2", "action": "ABSTAIN", "reasonCode": "NEGATIVE_EDGE"}]}

    def place_paper(self, runner_id: str) -> dict:
        if self.stale:
            raise ValueError("STALE_QUOTE")
        candidate = self.scan()["candidates"][0]
        if runner_id != candidate["runnerId"] or candidate["action"] != "PAPER_CANDIDATE":
            raise ValueError("NOT_ACTIONABLE")
        position = {"id": f"paper-{uuid4().hex[:10]}", "runnerId": runner_id, "status": "OPEN", "stake": 20.0, "odds": 3.55, "commission": .2, "pnl": None, "createdAt": datetime.now(timezone.utc).isoformat()}
        self.positions.append(position)
        return dict(position)

    def settle(self, position_id: str, outcome: str) -> dict:
        position = next((item for item in self.positions if item["id"] == position_id), None)
        if position is None:
            raise ValueError("POSITION_NOT_FOUND")
        if position["status"] == "SETTLED":
            return dict(position)
        position["status"] = "SETTLED"
        position["outcome"] = outcome
        position["pnl"] = round(position["stake"] * (position["odds"] - 1) - position["commission"], 2) if outcome == "WON" else 0.0 if outcome in {"VOID", "NON_RUNNER"} else -position["stake"] - position["commission"]
        return dict(position)

    def performance(self) -> dict:
        settled = [p for p in self.positions if p["status"] == "SETTLED"]
        metrics = calculate_metrics([{"probability": .34, "outcome": 1 if p.get("outcome") == "WON" else 0, "stake": p["stake"], "pnl": p["pnl"] or 0} for p in settled])
        return {"settledPositions": len(settled), **metrics}

    def sync_worker(self, cycle_id: str, counts: dict) -> dict:
        return self.sync_store.apply(cycle_id, counts)
