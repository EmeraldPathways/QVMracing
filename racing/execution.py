def calculate_stake(*, probability: float, odds: float, bankroll: float, max_stake_pct: float, quarter_kelly: float = .25) -> float:
    if odds <= 1 or not 0 <= probability <= 1 or bankroll <= 0:
        raise ValueError("invalid staking inputs")
    edge = probability * odds - 1
    if edge <= 0:
        return 0.0
    b = odds - 1
    kelly = max(0.0, (probability * odds - 1) / b)
    return round(min(bankroll * max_stake_pct, bankroll * kelly * quarter_kelly), 2)


def settle_position(position: dict, outcome: str) -> dict:
    if position.get("status") == "SETTLED":
        return position
    updated = dict(position)
    stake = float(position["stake"])
    odds = float(position["odds"])
    commission = float(position.get("commission", 0))
    if outcome == "WON":
        updated["pnl"] = round(stake * (odds - 1) - commission, 2)
    elif outcome in {"VOID", "NON_RUNNER"}:
        updated["pnl"] = 0.0
    elif outcome == "LOST":
        updated["pnl"] = round(-stake - commission, 2)
    else:
        raise ValueError("unsupported settlement outcome")
    updated["status"] = "SETTLED"
    updated["outcome"] = outcome
    return updated


def place_paper_position(*, runner_id: str, race_id: str, stake: float, price: float, gate_reasons: list[str]) -> dict:
    if stake <= 0 or price <= 1:
        raise ValueError("invalid paper position")
    if gate_reasons:
        raise ValueError(gate_reasons[0])
    return {"id": f"paper-{runner_id}", "runnerId": runner_id, "raceId": race_id, "stake": stake, "price": price, "status": "APPROVED", "gateReasons": []}
