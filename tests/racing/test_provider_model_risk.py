from datetime import datetime, timedelta, timezone

import pytest

from racing.market import freshness_budget_seconds, quote_gate
from racing.model import no_vig_probabilities, predict_race
from racing.providers.demo import DemoRacingProvider


def test_demo_provider_ids_are_stable():
    now = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    provider = DemoRacingProvider(clock=lambda: now)
    races = provider.list_races(now, now + timedelta(hours=2))
    assert races[0]["providerRaceId"] == "demo:kempton:20260919:1420"
    assert [x["providerRunnerId"] for x in provider.list_runners(races[0]["providerRaceId"])] == ["demo:horse:1", "demo:horse:2"]


def test_probability_vector_excludes_withdrawn_runner_and_normalizes():
    runners = [{"id": "r1", "declarationStatus": "DECLARED"}, {"id": "r2", "declarationStatus": "WITHDRAWN"}, {"id": "r3", "declarationStatus": "DECLARED"}]
    out = predict_race(runners, {"r1": {"rating": 80}, "r3": {"rating": 70}}, {"r1": 2.0, "r3": 3.0})
    assert {x.runner_id for x in out} == {"r1", "r3"}
    assert sum(x.probability for x in out) == pytest.approx(1.0)


def test_freshness_policy_blocks_close_stale_and_suspended_quotes():
    now = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    assert freshness_budget_seconds(2700) == 300
    allowed = quote_gate(now=now, scheduled_off_at=now + timedelta(minutes=45), captured_at=now - timedelta(seconds=300), source_updated_at=now - timedelta(seconds=300), market_status="OPEN", declaration_status="DECLARED")
    assert allowed.allowed
    stale = quote_gate(now=now, scheduled_off_at=now + timedelta(minutes=20), captured_at=now - timedelta(seconds=61), source_updated_at=now - timedelta(seconds=61), market_status="OPEN", declaration_status="DECLARED")
    assert not stale.allowed and stale.reason_code == "STALE_QUOTE"
    suspended = quote_gate(now=now, scheduled_off_at=now + timedelta(minutes=45), captured_at=now, source_updated_at=now, market_status="SUSPENDED", declaration_status="DECLARED")
    assert not suspended.allowed and suspended.reason_code == "MARKET_NOT_OPEN"


def test_no_vig_rejects_invalid_odds():
    assert no_vig_probabilities({"a": 2.0, "b": 4.0})["a"] == pytest.approx(2 / 3)
    with pytest.raises(ValueError):
        no_vig_probabilities({"a": 1.0})
