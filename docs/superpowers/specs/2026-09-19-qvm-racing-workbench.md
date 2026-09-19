# QVM Racing Workbench implementation boundary

QVM Racing Workbench is a separate horse-racing paper-research application. It uses UTC timestamps, normalized races/runners/quotes, the `racing-logit-v1` model, `market-no-vig-v1` baseline, dynamic freshness gates, paper positions, settlement, walk-forward validation, worker heartbeats, and audit records.

It must not copy or modify QVM Football Workbench data, credentials, bindings, workers, or databases. The first release excludes live orders, in-play execution, exotic markets, and real-money credentials. Provider integrations are read-only and vendor-neutral; Betfair is intentionally excluded.
