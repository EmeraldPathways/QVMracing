from dataclasses import dataclass
from typing import Any

from .time import parse_utc


def _timestamp(value: Any) -> str:
    parse_utc(value)
    return value


@dataclass(frozen=True)
class PredictionRecord:
    runner_id: str
    probability: float


@dataclass(frozen=True)
class RacingSyncSnapshot:
    schema_version: str
    cycle_id: str
    generated_at: str
    predictions: tuple[PredictionRecord, ...]

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "RacingSyncSnapshot":
        if value.get("schemaVersion") != "qvm-racing-sync.v1":
            raise ValueError("unsupported schema version")
        _timestamp(value["generatedAt"])
        for race in value.get("races", []):
            _timestamp(race["scheduledOffAt"])
            if race.get("sourceUpdatedAt"):
                _timestamp(race["sourceUpdatedAt"])
        for quote in value.get("quotes", []):
            _timestamp(quote["capturedAt"])
            if quote.get("sourceUpdatedAt"):
                _timestamp(quote["sourceUpdatedAt"])
            if float(quote.get("backOdds", 0)) <= 1:
                raise ValueError("executable odds must be greater than 1")
        predictions = tuple(PredictionRecord(x["providerRunnerId"], float(x["probability"])) for x in value.get("predictions", []))
        if not predictions or any(x.probability < 0 or x.probability > 1 for x in predictions):
            raise ValueError("invalid probability")
        if abs(sum(x.probability for x in predictions) - 1.0) > 1e-6:
            raise ValueError("probabilities must sum to 1")
        heartbeat = value.get("heartbeat", {})
        for key in ("lastStartedAt", "lastFinishedAt", "lastAttemptedSyncAt"):
            if heartbeat.get(key):
                _timestamp(heartbeat[key])
        return cls(value["schemaVersion"], value["cycleId"], value["generatedAt"], predictions)
