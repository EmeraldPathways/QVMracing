STATUS_MAP = {"SCRATCHED": "WITHDRAWN", "NON_RUNNER": "WITHDRAWN", "WITHDRAWN": "WITHDRAWN", "DECLARED": "DECLARED", "RUNNER": "DECLARED", "FINISHED": "FINISHED"}


def normalize_race(raw: dict) -> dict:
    return {"provider": raw["provider"], "providerRaceId": raw["race_id"], "venue": raw["venue"].strip(), "country": raw.get("country", ""), "scheduledOffAt": raw["scheduled_off_at"], "surface": raw.get("surface", "UNKNOWN"), "discipline": raw.get("discipline", "UNKNOWN"), "distanceMeters": raw.get("distance_meters"), "going": raw.get("going"), "className": raw.get("class_name"), "fieldSize": raw.get("field_size"), "status": raw.get("status", "SCHEDULED")}


def normalize_runner(raw: dict) -> dict:
    return {
        "provider": raw["provider"],
        "raceProviderId": raw["race_id"],
        "providerRunnerId": raw["runner_id"],
        "horseName": raw["name"].strip(),
        "declarationStatus": STATUS_MAP.get(str(raw.get("status", "DECLARED")).upper(), "DECLARED"),
    }


def normalize_quote(raw: dict) -> dict:
    if float(raw.get("back_odds", 0)) <= 1:
        raise ValueError("executable odds must be greater than 1")
    return {
        "provider": raw["provider"], "raceProviderId": raw["race_id"], "providerRunnerId": raw["runner_id"],
        "marketType": raw["market_type"].upper(), "backOdds": float(raw["back_odds"]),
        "capturedAt": raw["captured_at"], "sourceUpdatedAt": raw.get("source_updated_at"), "marketStatus": raw.get("market_status", "OPEN").upper(),
    }
