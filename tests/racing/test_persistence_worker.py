from datetime import datetime, timezone

import pytest

from racing.database import RacingDatabase
from racing.worker_service import RacingWorkerService


def test_racing_database_enforces_provider_identity_and_sync_idempotency(tmp_path):
    db = RacingDatabase(str(tmp_path / "qvm_racing.sqlite3"))
    db.initialize()
    race = {"provider": "demo", "providerRaceId": "demo:race:1", "venue": "Kempton", "scheduledOffAt": "2026-09-19T14:20:00Z", "status": "SCHEDULED"}
    db.upsert_race(race)
    db.upsert_race(race)
    assert db.count("racing_races") == 1
    db.insert_cycle("cycle-1")
    with pytest.raises(ValueError):
        db.insert_cycle("cycle-1")
    assert db.count("racing_worker_heartbeats") == 0


def test_worker_failure_advances_heartbeat_and_exposes_error():
    class BrokenProvider:
        def list_races(self, *_):
            raise RuntimeError("provider unavailable")

    db = RacingDatabase(":memory:")
    service = RacingWorkerService(db, BrokenProvider(), clock=lambda: datetime(2026, 9, 19, 12, tzinfo=timezone.utc))
    report = service.run_once()
    heartbeat = db.latest_heartbeat()
    assert report.status == "DEGRADED"
    assert heartbeat["lastStartedAt"] == "2026-09-19T12:00:00Z"
    assert heartbeat["lastFinishedAt"] == "2026-09-19T12:00:00Z"
    assert heartbeat["lastError"] == "provider unavailable"
