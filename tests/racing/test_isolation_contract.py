from pathlib import Path


def test_racing_runtime_names_are_separate():
    root = Path(__file__).parents[2]
    env_text = (root / ".env.racing.example").read_text()
    assert "QVM_RACING_SITE_URL" in env_text
    assert "QVM_RACING_WORKER_SHARED_SECRET" in env_text
    assert "QVM_SITE_URL=" not in env_text
    assert "QVM_WORKER_SHARED_SECRET=" not in env_text


def test_racing_sources_do_not_expose_live_order_methods():
    root = Path(__file__).parents[2]
    source = "\n".join(p.read_text(errors="ignore") for p in (root / "racing").rglob("*.py"))
    assert "place_order" not in source
    assert "submit_bet" not in source
    assert "cancel_order" not in source
