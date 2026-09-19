from racing.worker_timeout import next_interval_seconds


def test_near_off_interval_requires_provider_support():
    assert next_interval_seconds(300, True) == 15
    assert next_interval_seconds(300, False) == 300
