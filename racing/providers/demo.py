from datetime import datetime


class DemoRacingProvider:
    name = "demo"

    def __init__(self, clock):
        self.clock = clock

    def list_races(self, start: datetime, end: datetime) -> list[dict]:
        return [{
            "provider": "demo", "providerRaceId": "demo:kempton:20260919:1420", "venue": "Kempton", "country": "GB",
            "scheduledOffAt": "2026-09-19T14:20:00Z", "surface": "TURF", "discipline": "FLAT", "distanceMeters": 1600,
            "going": "GOOD", "className": "4", "fieldSize": 2, "status": "SCHEDULED", "sourceUpdatedAt": self.clock().isoformat().replace("+00:00", "Z")
        }]

    def list_runners(self, provider_race_id: str) -> list[dict]:
        return [
            {"provider": "demo", "raceProviderId": provider_race_id, "providerRunnerId": "demo:horse:1", "horseName": "Alpha Meridian", "declarationStatus": "DECLARED", "rating": 82},
            {"provider": "demo", "raceProviderId": provider_race_id, "providerRunnerId": "demo:horse:2", "horseName": "Blue Lantern", "declarationStatus": "DECLARED", "rating": 74},
        ]

    def list_quotes(self, provider_race_id: str) -> list[dict]:
        captured = self.clock().isoformat().replace("+00:00", "Z")
        return [{"provider": "demo", "raceProviderId": provider_race_id, "providerRunnerId": "demo:horse:1", "marketType": "WIN", "backOdds": 3.55, "capturedAt": captured, "sourceUpdatedAt": captured, "marketStatus": "OPEN"}, {"provider": "demo", "raceProviderId": provider_race_id, "providerRunnerId": "demo:horse:2", "marketType": "WIN", "backOdds": 4.0, "capturedAt": captured, "sourceUpdatedAt": captured, "marketStatus": "OPEN"}]

    def list_results(self, provider_race_id: str) -> list[dict]:
        return []

    def health(self):
        from racing.provider import ProviderHealth
        return ProviderHealth(self.name, "HEALTHY", self.clock())
