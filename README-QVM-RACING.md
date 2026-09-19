# QVM Racing Workbench

The first build slice is a private, paper-only horse-racing research workbench using deterministic demo data. It is intentionally separate from QVM Football Workbench.

## Current boundary

- No live bookmaker or exchange order placement.
- No in-play trading.
- Demo data remains the safe fallback; no Betfair adapter or Betfair credential is used.
- The Racing API is a read-only fixture/results source, enabled with `RACING_API_USERNAME` and `RACING_API_PASSWORD`.
- Open-Meteo supplies forecast and historical hourly weather without an API key.
- External integrations use a vendor-neutral read-only provider boundary and never place orders.
- Dynamic quote freshness is visible in the UI and near-off data is fail-closed.
- `AUTO_PAPER_TRADES` is off by default.

## Data requirements

- Up-to-date racecards are required for the Race Finder, declaration checks, quote freshness, and paper decisions.
- Historical race results are required for form features, calibration, walk-forward backtesting, and honest performance reporting.
- Historical weather should be joined to completed races by venue coordinates and scheduled-off time, using only data available at the relevant timestamp.

The hosted Worker exposes `/api/qvm/racing/fixtures`, `/api/qvm/racing/history`, `/api/qvm/racing/weather`, and `/api/qvm/racing/integrations`. Credentials are server-side only; when absent, the UI clearly remains on demo fallback.

## Next implementation stages

1. Add the racing-only persistence and versioned sync contract.
2. Add provider adapters, as-of feature construction, model calibration, paper ledger, and settlement.
3. Add the hosted API and worker sync route with separate racing secrets.
4. Add chronological backtesting and model-card reporting.
