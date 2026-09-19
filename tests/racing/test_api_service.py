import pytest

from racing.api_service import RacingApiService


def test_api_service_scans_candidates_and_blocks_stale_paper_action():
    service = RacingApiService()
    scan = service.scan()
    assert scan["modelVersion"] == "racing-logit-v1"
    assert scan["candidates"][0]["action"] == "PAPER_CANDIDATE"
    service.stale = True
    with pytest.raises(ValueError, match="STALE_QUOTE"):
        service.place_paper("demo:horse:1")


def test_api_service_worker_sync_is_idempotent_and_settlement_updates_performance():
    service = RacingApiService()
    first = service.sync_worker("cycle-1", {"races": 1})
    second = service.sync_worker("cycle-1", {"races": 99})
    assert first["idempotent"] is False and second["idempotent"] is True
    position = service.place_paper("demo:horse:1")
    service.settle(position["id"], "WON")
    assert service.performance()["settledPositions"] == 1
