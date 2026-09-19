from dataclasses import dataclass
from datetime import datetime

from .time import seconds_to_off


def freshness_budget_seconds(seconds: float) -> int:
    if seconds <= 0:
        return 0
    if seconds < 120:
        return 10
    if seconds < 600:
        return 30
    if seconds < 1800:
        return 60
    return 300


@dataclass(frozen=True)
class GateResult:
    allowed: bool
    reason_code: str
    age_seconds: float
    budget_seconds: int
    quality_penalty: float = 0.0


def quote_gate(*, now: datetime, scheduled_off_at: datetime, captured_at: datetime, source_updated_at: datetime | None, market_status: str, declaration_status: str) -> GateResult:
    to_off = seconds_to_off(scheduled_off_at, now)
    budget = freshness_budget_seconds(to_off)
    if to_off <= 0:
        return GateResult(False, "RACE_NOT_PRE_OFF", 0, budget)
    if market_status.upper() != "OPEN":
        return GateResult(False, "MARKET_NOT_OPEN", 0, budget)
    if declaration_status.upper() in {"WITHDRAWN", "NON_RUNNER", "SCRATCHED"}:
        return GateResult(False, "RUNNER_NOT_ACTIVE", 0, budget)
    if source_updated_at is None and to_off < 1800:
        return GateResult(False, "SOURCE_TIMESTAMP_REQUIRED", 0, budget, 0.2)
    effective = max(captured_at, source_updated_at or captured_at)
    age = max(0.0, (now - effective).total_seconds())
    if age > budget:
        return GateResult(False, "STALE_QUOTE", age, budget, 0.0 if source_updated_at else 0.2)
    return GateResult(True, "ACTIONABLE", age, budget, 0.0 if source_updated_at else 0.2)
