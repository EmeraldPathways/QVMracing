from pathlib import Path


def test_windows_configuration_is_separate_and_documented():
    root = Path(__file__).parents[2]
    env = (root / ".env.windows-racing.example").read_text()
    docs = (root / "README-Windows-Racing.md").read_text()
    assert "qvm_racing.sqlite3" in env
    assert "QVM_RACING_SITE_URL" in env
    assert "C:\\QVM-Windows-Worker-v5" in docs
    assert ".\\run_qvm_racing_worker.ps1 -Once" in docs
