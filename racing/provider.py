from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class ProviderHealth:
    provider: str
    status: str
    checked_at: datetime
    message: str | None = None


class RacingProvider(Protocol):
    name: str

    def list_races(self, start: datetime, end: datetime) -> list[dict]: ...
    def list_runners(self, provider_race_id: str) -> list[dict]: ...
    def list_quotes(self, provider_race_id: str) -> list[dict]: ...
    def list_results(self, provider_race_id: str) -> list[dict]: ...
    def health(self) -> ProviderHealth: ...


class ReadOnlyHttpProvider:
    """Vendor-neutral read-only boundary; intentionally has no order methods."""

    def __init__(self, name: str, fetch_json, clock):
        self.name = name
        self._fetch_json = fetch_json
        self._clock = clock

    def list_races(self, start: datetime, end: datetime) -> list[dict]:
        return self._fetch_json("races", {"start": start.isoformat(), "end": end.isoformat()})

    def list_runners(self, provider_race_id: str) -> list[dict]:
        return self._fetch_json("runners", {"raceId": provider_race_id})

    def list_quotes(self, provider_race_id: str) -> list[dict]:
        return self._fetch_json("quotes", {"raceId": provider_race_id})

    def list_results(self, provider_race_id: str) -> list[dict]:
        return self._fetch_json("results", {"raceId": provider_race_id})

    def health(self) -> ProviderHealth:
        try:
            self._fetch_json("health", {})
            return ProviderHealth(self.name, "HEALTHY", self._clock())
        except Exception as exc:
            return ProviderHealth(self.name, "DEGRADED", self._clock(), str(exc))
