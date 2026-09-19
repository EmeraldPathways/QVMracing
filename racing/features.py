from datetime import datetime

from .time import parse_utc


def build_as_of_features(scheduled_off_at: datetime, form_rows: list) -> dict:
    eligible = [row for row in form_rows if parse_utc(row.available_at) <= parse_utc(scheduled_off_at)]
    if not eligible:
        return {"latest_speed_figure": None, "runs_seen": 0}
    latest = max(eligible, key=lambda row: parse_utc(row.available_at))
    return {"latest_speed_figure": latest.speed_figure, "runs_seen": len(eligible)}
