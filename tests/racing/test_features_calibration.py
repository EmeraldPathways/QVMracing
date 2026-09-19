from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from racing.calibration import calibration_report
from racing.features import build_as_of_features


def test_features_use_only_rows_available_before_off():
    off = datetime(2026, 9, 19, 12, 30, tzinfo=timezone.utc)
    rows = [SimpleNamespace(available_at=datetime(2026, 9, 18, 10, tzinfo=timezone.utc), speed_figure=82), SimpleNamespace(available_at=datetime(2026, 9, 19, 12, 31, tzinfo=timezone.utc), speed_figure=99)]
    features = build_as_of_features(off, rows)
    assert features == {"latest_speed_figure": 82, "runs_seen": 1}


def test_calibration_is_visible_as_insufficient_without_sample_threshold():
    result = calibration_report([{"probability": .4, "outcome": 1}], minimum_samples=10)
    assert result["status"] == "CALIBRATION_INSUFFICIENT"
    assert result["raw_probability_preserved"] is True

