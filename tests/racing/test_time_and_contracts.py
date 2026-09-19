from datetime import datetime, timezone

import pytest

from racing.contracts import RacingSyncSnapshot
from racing.time import parse_utc, seconds_to_off


def payload():
    captured = "2026-09-19T12:00:00Z"
    return {
        "schemaVersion": "qvm-racing-sync.v1",
        "cycleId": "cycle-demo-1",
        "generatedAt": captured,
        "races": [{
            "provider": "demo", "providerRaceId": "demo:race:1", "venue": "Kempton", "country": "GB",
            "scheduledOffAt": "2026-09-19T12:30:00Z", "surface": "TURF", "discipline": "FLAT",
            "distanceMeters": 1600, "going": "GOOD", "className": "4", "fieldSize": 2, "status": "SCHEDULED",
            "sourceUpdatedAt": captured,
        }],
        "runners": [
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:1", "horseName": "Alpha", "declarationStatus": "DECLARED"},
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:2", "horseName": "Beta", "declarationStatus": "DECLARED"},
        ],
        "quotes": [
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:1", "marketType": "WIN", "backOdds": 2.0, "capturedAt": captured, "sourceUpdatedAt": captured, "marketStatus": "OPEN"},
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:2", "marketType": "WIN", "backOdds": 2.0, "capturedAt": captured, "sourceUpdatedAt": captured, "marketStatus": "OPEN"},
        ],
        "predictions": [
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:1", "modelVersion": "racing-logit-v1", "probability": 0.5, "fairOdds": 2.0, "calculatedAt": captured, "featureSnapshotId": "snapshot-1"},
            {"provider": "demo", "raceProviderId": "demo:race:1", "providerRunnerId": "demo:horse:2", "modelVersion": "racing-logit-v1", "probability": 0.5, "fairOdds": 2.0, "calculatedAt": captured, "featureSnapshotId": "snapshot-1"},
        ], "paperPositions": [], "agentRuns": [],
        "heartbeat": {"workerName": "qvm-racing-worker", "status": "READY", "lastStartedAt": captured, "lastFinishedAt": captured, "lastAttemptedSyncAt": captured, "lastSuccessfulSyncAt": captured, "cyclesCompleted": 1},
    }


def test_contract_accepts_valid_payload_and_rejects_naive_timestamp():
    parsed = RacingSyncSnapshot.from_dict(payload())
    assert parsed.schema_version == "qvm-racing-sync.v1"
    assert sum(item.probability for item in parsed.predictions) == pytest.approx(1.0)
    invalid = payload()
    invalid["generatedAt"] = "2026-09-19T12:00:00"
    with pytest.raises(ValueError, match="UTC"):
        RacingSyncSnapshot.from_dict(invalid)


def test_time_helpers_return_utc_and_seconds_to_off():
    now = parse_utc("2026-09-19T12:00:00Z")
    assert now.tzinfo == timezone.utc
    assert seconds_to_off("2026-09-19T12:30:00Z", now) == 1800

