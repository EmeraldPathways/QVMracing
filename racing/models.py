from dataclasses import dataclass


@dataclass(frozen=True)
class Race:
    provider: str
    provider_race_id: str
    venue: str
    scheduled_off_at: str
    status: str


@dataclass(frozen=True)
class Runner:
    race_provider_id: str
    provider_runner_id: str
    horse_name: str
    declaration_status: str


@dataclass(frozen=True)
class PaperPosition:
    id: str
    race_provider_id: str
    provider_runner_id: str
    stake: float
    status: str
    gate_reasons: tuple[str, ...]
