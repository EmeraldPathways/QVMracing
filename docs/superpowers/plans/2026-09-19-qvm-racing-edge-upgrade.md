# QVM Racing Edge Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved ten UI/UX and ten functionality improvements so QVM Racing measures evidence quality, market value, calibration, closing-line value, and paper outcomes without enabling live execution.

**Architecture:** Keep the hosted Worker as the server-side provider and decision boundary. Add pure calculations in a small `racing/edge.js` module, extend API responses and D1 paper snapshots in `worker.js`, and make `public/app.js` render the live decision model instead of disconnected demo cards. Preserve the existing static client and no-worker user experience.

**Tech Stack:** Cloudflare-style Worker JavaScript, vanilla browser JavaScript/CSS, D1-compatible SQL, Node test runner, Sites deployment.

**Spec:** `docs/superpowers/specs/2026-09-19-qvm-racing-edge-design.md`

## Global Constraints

- Paper-only: no live order placement, bookmaker adapter, exchange adapter, or Betfair credential.
- OpenAI is explanatory only and cannot bypass deterministic gates.
- Racing API and Open-Meteo credentials remain server-side.
- Missing or synthetic fields must be visibly labelled and never treated as live evidence.
- Every decision stores model version, data cutoff, source timestamps, and gate results.
- No browser localStorage is used for positions or research state.

## Review Focus

- Incomplete race books must not produce false no-vig probabilities; test incomplete and duplicate runners.
- Stale or missing quote timestamps must fail closed; test each freshness band and provider-limit response.
- Historical evaluation must reject future observations; test cutoff enforcement with an out-of-order fixture.
- Model probability and market probability must remain distinguishable; test displayed edge against the same normalized inputs.
- Paper settlement and closing-line records must be idempotent; test repeated settlement and missing position IDs.

### Task 1: Pure edge and evidence calculations

**Files:**
- Create: `racing/edge.js`
- Test: `tests/racing-edge.test.mjs`
- Modify: `worker.js`

**Interfaces:**
- `normalizeBook(runners)` returns `{complete, overround, runners, reason}`.
- `edgeDecision(input)` returns `{status, fairOdds, noVigProbability, expectedValue, uncertainty, gates, reasons}`.
- `closingLineValue(selectionOdds, closeOdds, side)` returns a numeric percentage.

- [ ] Write failing tests for overround normalization, missing quotes, stale quotes, expected value, uncertainty vetoes, and closing-line value.
- [ ] Run `node --test tests/racing-edge.test.mjs` and observe the missing-module failure.
- [ ] Implement the pure functions with finite-number validation and fail-closed defaults.
- [ ] Run the focused test until all edge tests pass.
- [ ] Add `/api/qvm/racing/decision` to expose deterministic candidate/gate output without OpenAI.
- [ ] Run worker and UI tests and commit `feat: add racing edge calculations and gates`.

### Task 2: Hosted snapshots, market movement, and paper audit trail

**Files:**
- Modify: `worker.js`
- Modify: `tests/racing-worker.test.mjs`
- Modify: `tests/racing-api.test.mjs`

**Interfaces:**
- D1 table `racing_decision_snapshots` stores race ID, runner ID, quote, close quote, model probability, market probability, gate JSON, source timestamps, model version, and outcome fields.
- `POST /api/qvm/racing/snapshots` accepts only server-produced decision snapshots.
- `GET /api/qvm/racing/market-movement?runnerId=` returns selection/near-off/close prices and CLV.
- Paper position rows reference `snapshot_id` and remain idempotent on settlement.

- [ ] Write failing tests for schema creation, snapshot retrieval, repeated settlement, CLV, and server-side rejection of arbitrary client probabilities.
- [ ] Run the focused tests and verify the expected failures.
- [ ] Implement schema and endpoint changes, preserving existing rows and paper-only behavior.
- [ ] Add safe provider-limit handling and a short server cache for weather/fixtures to avoid repeated Open-Meteo calls on every render.
- [ ] Run API and worker tests and commit `feat: persist decision evidence and market movement`.

### Task 3: Dashboard and Race Finder decision workspace

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/racing-ui.test.mjs`

**Interfaces:**
- `decisionCard(candidate)` renders source age, no-vig probability, fair odds, current odds, EV, confidence, gates, and an explicit reason.
- `filterRaces(query)` filters the normalized live fixture list without mutating the source list.

- [ ] Write failing UI contract tests for decision-quality cards, filters, blocked reasons, provider states, and the paper review snapshot.
- [ ] Run UI tests and verify the new required strings are absent.
- [ ] Implement a dashboard command centre, searchable/filterable Race Finder, evidence detail panel, freshness badges, and explicit stale/provider-limit states.
- [ ] Wire Inspect, filters, refresh, and paper review controls to actual state transitions.
- [ ] Run UI tests and commit `feat: build evidence-first race workspace`.

### Task 4: Performance, calibration, and research workbench

**Files:**
- Modify: `worker.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/racing-worker.test.mjs`
- Modify: `tests/racing-ui.test.mjs`

**Interfaces:**
- `GET /api/qvm/racing/performance` returns settled count, turnover, P&L, drawdown, CLV, Brier score, log loss, calibration bins, and benchmark fields with `sampleStatus`.
- `GET /api/qvm/racing/research` returns chronological evaluation metadata and leakage status.

- [ ] Write failing tests for Brier score, log loss, calibration bins, drawdown, CLV aggregation, and insufficient-sample reporting.
- [ ] Run tests and verify the expected missing metric failures.
- [ ] Implement metrics from persisted snapshots/results, never from future data after the decision cutoff.
- [ ] Replace placeholder Performance and Research pages with concise charts/tables and benchmark comparisons.
- [ ] Run the full Node suite and commit `feat: add calibration and research feedback loop`.

### Task 5: Responsive accessibility and interaction polish

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/racing-ui.test.mjs`

**Interfaces:**
- Navigation controls expose visible labels at supported mobile widths and accessible names at all widths.
- Tables retain a labelled horizontal scroll region only where comparison requires it.
- Loading, empty, error, success, and provider-limit states use `aria-live` status messaging.

- [ ] Write failing tests for accessible labels, focus-visible styles, loading/error states, mobile navigation labels, and no live-order vocabulary.
- [ ] Run the tests and verify the new accessibility contracts fail.
- [ ] Implement responsive bottom navigation, keyboard focus, semantic headings/labels, readable text sizing, status announcements, and clearer success/error toasts.
- [ ] Run browser checks at desktop and narrow viewport sizes, including navigation, filtering, paper approval, settlement, AI explanation, and performance.
- [ ] Commit `feat: polish responsive accessible workbench UX`.

### Task 6: Full verification, branch push, and deployment

**Files:**
- Modify: `README-QVM-RACING.md`
- Create: `docs/qvm-racing-edge-release.md`

- [ ] Run `npm run build`.
- [ ] Run `node --test tests/*.test.mjs`.
- [ ] Run Python tests when the environment provides `pytest`; record the environment limitation if unavailable.
- [ ] Exercise live integrations with bounded requests: integrations, fixtures, history, weather, decision, AI, paper position, settlement, performance.
- [ ] Exercise every page and core interaction in the public browser and inspect app logs for non-extension errors.
- [ ] Package and save the exact pushed `ui-update` commit as a Sites version.
- [ ] Deploy that saved version publicly, verify deployment status, and repeat smoke tests against the production URL.
- [ ] Push the final source state to the remote `ui-update` branch and commit `docs: record edge upgrade verification`.
