from datetime import datetime, timezone


def parse_utc(value: str | datetime) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def seconds_to_off(scheduled_off_at: str | datetime, now: str | datetime) -> float:
    return (parse_utc(scheduled_off_at) - parse_utc(now)).total_seconds()
