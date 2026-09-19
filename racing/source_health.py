import hashlib
import json
from datetime import datetime, timezone


def record_raw_snapshot(provider: str, endpoint: str, payload: dict, captured_at: str | None = None) -> dict:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return {"provider": provider, "endpoint": endpoint, "contentHash": hashlib.sha256(body.encode()).hexdigest(), "capturedAt": captured_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "availableAt": captured_at, "status": "RECEIVED", "payload": payload}
