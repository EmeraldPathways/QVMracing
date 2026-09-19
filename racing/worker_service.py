from datetime import datetime, timezone
from uuid import uuid4


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class RacingWorkerService:
    def __init__(self, database, provider, clock=None):
        self.database = database
        self.provider = provider
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def run_once(self):
        cycle_id = f"cycle-{uuid4().hex[:12]}"
        started = self.clock()
        status = "SUCCEEDED"
        error = None
        try:
            self.database.insert_cycle(cycle_id)
            races = self.provider.list_races(started, started)
            for race in races:
                self.database.upsert_race(race)
        except Exception as exc:
            status = "DEGRADED"
            error = str(exc)
        finished = self.clock()
        self.database.save_heartbeat({
            "cycleId": cycle_id, "status": status, "lastStartedAt": _iso(started), "lastFinishedAt": _iso(finished),
            "lastAttemptedSyncAt": _iso(finished), "lastSuccessfulSyncAt": _iso(finished) if status == "SUCCEEDED" else None, "lastError": error,
        })
        return type("WorkerReport", (), {"cycle_id": cycle_id, "status": status, "error": error})()


if __name__ == "__main__":
    from .database import RacingDatabase
    from .providers.demo import DemoRacingProvider
    service = RacingWorkerService(RacingDatabase("qvm_racing.sqlite3"), DemoRacingProvider(lambda: datetime.now(timezone.utc)))
    report = service.run_once()
    raise SystemExit(0 if report.status == "SUCCEEDED" else 1)
