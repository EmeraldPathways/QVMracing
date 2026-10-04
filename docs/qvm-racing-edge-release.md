# QVM Racing Edge Upgrade

## Delivered

The `ui-update` branch adds an evidence-first dashboard, searchable Race Finder, responsive labelled navigation, decision cards, explicit no-bet reasons, source/freshness states, accessible status announcements, paper review/settlement flow, calibration and research surfaces, server-owned snapshots, overround/no-vig calculations, post-cost EV, uncertainty gates, closing-line tracking contracts, and paper performance metrics.

## Honest operating boundary

The current free Racing API fixture response does not always include a complete runner-level executable odds book. When a complete, fresh book is not available, QVM labels the evidence as demo or insufficient and abstains instead of presenting a synthetic edge as live value. Calibration, CLV, and benchmark results remain `INSUFFICIENT_DATA` until dated snapshots and settlements reach the sample threshold.

## Research basis

- Probability calibration and Brier score are distinct diagnostics; the app tracks Brier score, log loss, and calibration bins rather than treating one metric as proof of accuracy.
- UK racing odds bias changes over time, so the research view treats odds bias as a re-estimated market feature rather than a permanent assumption.
- Historical weather and forecast archives can support timestamp-safe feature construction, but the app must use only information available before scheduled off.

## Verification checklist

- Node build: passed.
- Node tests: 28 passed, 0 failed.
- Python tests: 22 passed, 0 failed.
- Live verification remains required after the `ui-update` deployment: integrations, fixtures, history, weather-limit handling, decision, OpenAI, paper ledger, settlement, performance, browser navigation, filters, responsive layout, and console logs.
