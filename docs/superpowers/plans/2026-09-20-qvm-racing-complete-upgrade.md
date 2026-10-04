# QVM Racing Complete Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the QVM Racing Workbench into a measurable, paper-only racing research system with durable odds evidence, replayable decisions, stronger calibration, risk controls, and responsive live/results/research workflows.

**Architecture:** Keep the existing Cloudflare Worker and D1 architecture. Add pure deterministic analytics in `racing/analytics.js`, server-owned evidence tables and JSON APIs in `worker.js`, and use the existing single-page client with explicit dashboard, live, results, research, and settings modes. The application remains paper-only and fails closed when complete, fresh runner-level odds are unavailable.

**Tech Stack:** Cloudflare Worker, D1, vanilla HTML/CSS/JavaScript, Node test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-09-19-qvm-racing-edge-design.md`

## Global Constraints

- No live order placement or Betfair dependency.
- No fabricated live runner odds; imported or provider-supplied quotes must be timestamped.
- Every model decision records its input snapshot and can be replayed.
- Historical evaluation is walk-forward and uses only information available before scheduled off.
- Paper positions remain explicitly approved, capped, and auditable.
- Mobile layouts must avoid unintended horizontal scrolling; wide data is presented as cards or an explicitly scrollable table.

## Review Focus

- Missing runner-level odds must produce a visible blocked state rather than a candidate.
- Non-runners must be removed from market probability calculations.
- Same-day provider failure must fall back without masking historical-plan failure.
- Imported data must reject invalid odds, duplicate runners, bad timestamps, and future information.
- Risk limits must block stakes before a paper position is created.

### Task 1: Deterministic analytics and validation

Create pure functions for segment metrics, odds movement, drift, risk caps, feature provenance, and import validation. Add red tests, implement, then run the Node and Python suites.

### Task 2: Durable evidence and operational APIs

Extend D1 schema initialization and add endpoints for runner quote snapshots, race lifecycle updates, imports, provider health, decision replay, research notes, saved filters, alerts, and performance series. Preserve memory fallback for unit tests.

### Task 3: Accurate decision pipeline

Require complete runner books for live candidates, adjust for withdrawals, apply market/model blending and uncertainty gates, calculate stake from configured limits, and expose segment calibration, CLV, slippage, drift, and data-quality diagnostics.

### Task 4: Product workflows and responsive UI

Add compact live/results/research modes, saved filters, watchlist and alert controls, decision replay, import controls, risk settings, performance charts, provider-health explanations, accessible icon actions, responsive runner cards, and mobile-safe layout rules.

### Task 5: Verification and release

Run build, 28+ existing Node tests plus upgrade tests, pytest, browser navigation and interaction checks, desktop overflow checks, mobile breakpoint checks, then package, deploy, and repeat live API/browser smoke tests.
