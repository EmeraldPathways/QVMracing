from datetime import datetime, timezone

import pytest

from racing.backtest import walk_forward_races
from racing.execution import calculate_stake, settle_position


def test_stake_is_quarter_kelly_and_capped():
    assert calculate_stake(probability=.34, odds=3.55, bankroll=1000, max_stake_pct=.02) == pytest.approx(20)
    with pytest.raises(ValueError):
        calculate_stake(probability=.5, odds=1, bankroll=1000, max_stake_pct=.02)


def test_settlement_is_idempotent_and_handles_non_runner():
    position = {"status": "OPEN", "stake": 20, "odds": 3.55, "commission": .2, "pnl": None}
    first = settle_position(position, "WON")
    second = settle_position(first, "WON")
    assert first == second
    assert first["pnl"] == pytest.approx(50.8)
    assert settle_position({"status": "OPEN", "stake": 20, "odds": 3.55, "commission": .2, "pnl": None}, "NON_RUNNER")["pnl"] == 0


def test_walk_forward_keeps_all_runners_in_one_race_split_and_excludes_future_data():
    races = [
        {"id": "r1", "scheduled_off_at": "2026-09-17T12:00:00Z", "runners": [{"id": "a", "available_at": "2026-09-16T12:00:00Z"}]},
        {"id": "r2", "scheduled_off_at": "2026-09-18T12:00:00Z", "runners": [{"id": "b", "available_at": "2026-09-17T12:00:00Z"}]},
        {"id": "r3", "scheduled_off_at": "2026-09-19T12:00:00Z", "runners": [{"id": "c", "available_at": "2026-09-20T12:00:00Z", "closing_price": 2.1}]},
    ]
    result = walk_forward_races(races)
    assert result["evaluation_ids"] == ["r2", "r3"]
    assert result["feature_rows"]["r3"] == []
