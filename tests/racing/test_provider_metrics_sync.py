from datetime import datetime, timezone

import pytest

from racing.metrics import calculate_metrics
from racing.normalise import normalize_quote, normalize_runner
from racing.sync import SyncStore


def test_normalization_preserves_provider_identity_and_source_times():
    runner = normalize_runner({"provider": "demo", "race_id": "r1", "runner_id": "h1", "name": " Alpha Meridian ", "status": "SCRATCHED"})
    quote = normalize_quote({"provider": "demo", "race_id": "r1", "runner_id": "h1", "market_type": "WIN", "back_odds": 3.5, "captured_at": "2026-09-19T12:00:05Z", "source_updated_at": "2026-09-19T12:00:00Z", "market_status": "OPEN"})
    assert runner["providerRunnerId"] == "h1" and runner["declarationStatus"] == "WITHDRAWN"
    assert quote["capturedAt"] != quote["sourceUpdatedAt"]


def test_metrics_report_accuracy_and_paper_performance_separately():
    result = calculate_metrics([{"probability": .75, "outcome": 1, "stake": 20, "pnl": 10}, {"probability": .25, "outcome": 0, "stake": 20, "pnl": -20}])
    assert result["sample_count"] == 2
    assert result["brier_score"] == pytest.approx((.25 ** 2 + .25 ** 2) / 2)
    assert result["net_paper_pnl"] == -10
    assert result["turnover"] == 40


def test_sync_store_is_idempotent_by_cycle_id():
    store = SyncStore()
    first = store.apply("cycle-1", {"races": 2, "quotes": 4})
    second = store.apply("cycle-1", {"races": 9, "quotes": 9})
    assert first["idempotent"] is False
    assert second == {"idempotent": True, "cycleId": "cycle-1", "counts": {"races": 2, "quotes": 4}}
