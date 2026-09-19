# QVM Racing model card

- Active model: `racing-logit-v1`
- Benchmark: `market-no-vig-v1` and favourite baseline
- Inputs: as-of ratings, form aggregates, runner metadata, field context, and executable WIN prices
- Leakage rule: every feature must be available at or before scheduled off
- Calibration: raw probabilities remain preserved; calibration is insufficient below the configured sample threshold
- Freshness: 300s distant, 60s at 10–30 minutes, 30s at 2–10 minutes, 10s inside 2 minutes
- Costs: recorded commission and slippage are applied to paper performance
- Abstention: stale, suspended, closed, post-off, missing close-window source timestamp, withdrawn, low-quality, unsupported-market, or risk-halted candidates
- Provider: deterministic demo and vendor-neutral read-only boundary; Betfair is not used

Backtest results do not establish future profitability and do not authorize real-money execution.
