PROVIDER_TIMEOUT_SECONDS = 30
SITE_SYNC_TIMEOUT_SECONDS = 300
WORKER_INTERVAL_SECONDS = 300
NEAR_OFF_INTERVAL_SECONDS = 15


def next_interval_seconds(seconds_to_off: float, provider_supports_near_off: bool) -> int:
    if 0 < seconds_to_off < 600:
        return NEAR_OFF_INTERVAL_SECONDS if provider_supports_near_off else WORKER_INTERVAL_SECONDS
    return WORKER_INTERVAL_SECONDS
