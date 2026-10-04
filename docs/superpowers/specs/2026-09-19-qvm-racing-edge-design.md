# QVM Racing Edge Upgrade Design

## Goal

Turn QVM Racing Workbench from a paper-only race dashboard into an evidence-first forecasting workbench that can measure whether its probabilities and prices create a repeatable edge.

## User and constraints

- The user is the sole operator and uses the public hosted web app.
- The product remains paper-only; it must never place live bookmaker or exchange orders.
- The app is fully online; no Windows worker is required.
- The Racing API remains the read-only fixture/results provider and Open-Meteo remains the weather provider.
- OpenAI may explain evidence, but deterministic gates—not the language model—control eligibility, staking, and abstention.
- Secrets remain server-side Sites environment variables.

## Product design

The dashboard becomes a decision-quality command centre. Each candidate displays the complete evidence chain: source timestamps, no-vig market probability, model probability, fair odds, executable odds, expected value, uncertainty, and the exact gate result. A race detail view exposes runner-level evidence and a paper approval flow preserves the input snapshot.

The mobile experience uses labelled navigation and stacked evidence cards. Tables remain available for desktop comparison, while important decisions never depend on horizontal scrolling. Empty, loading, stale, blocked, and provider-limit states are explicit and actionable.

## Functional design

1. Normalize and expose race, runner, quote, weather, model, and decision snapshots with source timestamps.
2. Calculate market overround and no-vig probabilities from a complete race book.
3. Track selection price, near-off price, closing-line value, and settlement.
4. Calculate calibration and accuracy metrics by probability and odds bands.
5. Enforce chronological walk-forward evaluation and reject future data in feature construction.
6. Compare the QVM model with market, favourite, and simple baselines.
7. Add uncertainty and abstention gates for incomplete, stale, unstable, or low-quality data.
8. Detect meaningful late price movement, withdrawals, field changes, and race status changes.
9. Build a feature/evidence summary for form, class, distance, going, course, trainer, jockey, field, rest, and weather where supplied.
10. Record model version, data cutoff, decision reason, and later outcome/closing price for every paper candidate.

## Implementation boundary for this release

The current hosted app has no guaranteed historical odds archive or complete runner-level form feed in the free provider response. Therefore this release implements the calculation, snapshot, gating, audit, and UI contracts using live provider data plus deterministic demo fixtures where fields are absent. It must label demo or missing inputs and must not present synthetic values as live evidence. The backtest and calibration surfaces report “insufficient sample” until enough dated results and snapshots exist.

## Acceptance criteria

- All navigation and controls work on desktop and narrow screens.
- A user can filter and inspect races, understand every candidate and veto, approve a paper position, settle it, and see the result in Performance.
- A candidate cannot pass when quote age, market completeness, data quality, or uncertainty gates fail.
- Market probability is normalized and edge is calculated after configurable costs.
- Every paper position stores the decision snapshot and model version.
- Research reports Brier score, log loss, calibration error, closing-line value, return, drawdown, and benchmark comparisons when sample size permits.
- OpenAI can summarize evidence but cannot create an order or override a gate.
- Build, automated tests, live API tests, and browser UI tests pass before deployment.
