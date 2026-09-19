from .time import parse_utc


def walk_forward_races(races: list[dict]) -> dict:
    ordered = sorted(races, key=lambda race: parse_utc(race["scheduled_off_at"]))
    evaluation_ids = []
    feature_rows = {}
    for index, race in enumerate(ordered):
        if index == 0:
            continue
        evaluation_ids.append(race["id"])
        off = parse_utc(race["scheduled_off_at"])
        feature_rows[race["id"]] = [row for row in race.get("runners", []) if parse_utc(row["available_at"]) <= off and "closing_price" not in row]
    return {"evaluation_ids": evaluation_ids, "feature_rows": feature_rows}


def run_walk_forward_backtest(races: list[dict]) -> dict:
    return walk_forward_races(races)
