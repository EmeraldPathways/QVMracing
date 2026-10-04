# QVM Racing Workbench

QVM Racing Workbench is a public, paper-only horse-racing research workbench with evidence-first decision gates. It is intentionally separate from QVM Football Workbench.

## Current boundary

- No live bookmaker or exchange order placement.
- No in-play trading.
- Demo data remains the safe fallback; no Betfair adapter or Betfair credential is used.
- The Racing API is a read-only fixture/results source, enabled with `RACING_API_USERNAME` and `RACING_API_PASSWORD`.
- Open-Meteo supplies forecast and historical hourly weather without an API key.
- External integrations use a vendor-neutral read-only provider boundary and never place orders.
- Dynamic quote freshness is visible in the UI and near-off data is fail-closed.
- `AUTO_PAPER_TRADES` is off by default.
- Market overround, no-vig probabilities, expected value, uncertainty gates, and closing-line value are calculated server-side.
- Paper positions are linked to server-owned decision snapshots with model version and source timestamps.
- Performance reports Brier score, log loss, calibration bins, drawdown, and sample sufficiency.
- The web app does not claim a live edge when runner-level odds snapshots are incomplete; those candidates are labelled demo or insufficient data.

## Data requirements

- Up-to-date racecards are required for the Race Finder, declaration checks, quote freshness, and paper decisions.
- Historical race results are required for form features, calibration, walk-forward backtesting, and honest performance reporting.
- Historical weather should be joined to completed races by venue coordinates and scheduled-off time, using only data available at the relevant timestamp.

The hosted Site exposes `/api/qvm/racing/fixtures`, `/api/qvm/racing/history`, `/api/qvm/racing/weather`, `/api/qvm/racing/integrations`, `/api/qvm/racing/decision`, `/api/qvm/racing/snapshots`, `/api/qvm/racing/market-movement`, `/api/qvm/racing/paper-positions`, `/api/qvm/racing/performance`, and `/api/qvm/racing/ai`. Credentials are server-side only; when absent, the UI clearly remains on limited fallback. No Windows worker, bridge, or local process is required.

## Next implementation stages

1. Add the racing-only persistence and versioned sync contract.
2. Add provider adapters, as-of feature construction, model calibration, paper ledger, and settlement.
3. Add the hosted API, hosted OpenAI assistant, and database-backed paper ledger with separate server-side secrets.
4. Add chronological backtesting and model-card reporting.
