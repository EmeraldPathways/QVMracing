import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContract, quoteSnapshotId } from "../racing/decision-contract.js";

const settings = { modelWeight: 1, maxQuoteAgeSeconds: 300, minDataQuality: 70 };
const race = { raceId: "race-trust-1", venue: "Trust Park", scheduledOffAt: "2026-10-04T18:00:00Z", status: "SCHEDULED" };
const runners = [
  { runnerId: "runner-1", horseName: "Scored Alpha", odds: 3.5, modelProbability: .4, status: "DECLARED" },
  { runnerId: "runner-2", horseName: "Second Runner", odds: 4.5, modelProbability: .2, status: "DECLARED" },
  { runnerId: "runner-3", horseName: "Third Runner", odds: 6, modelProbability: .1, status: "DECLARED" },
  { runnerId: "runner-4", horseName: "Fourth Runner", odds: 8, modelProbability: .08, status: "DECLARED" },
];

function quote(overrides = {}) {
  return {
    id: "quote-trust-1",
    raceId: race.raceId,
    provider: "irishracing.com",
    capturedAt: "2026-10-04T17:58:00Z",
    sourceUpdatedAt: "2026-10-04T17:57:30Z",
    completeBook: true,
    venue: race.venue,
    scheduledOffAt: race.scheduledOffAt,
    runners,
    ...overrides,
  };
}

test("a complete scored quote can produce a candidate contract", () => {
  const contract = buildDecisionContract({ race, quote: quote(), runnerId: "runner-1", settings, now: "2026-10-04T17:59:00Z" });
  assert.equal(contract.decision.status, "PAPER_CANDIDATE");
  assert.equal(contract.runner.runnerId, "runner-1");
  assert.equal(contract.gates.modelScore, true);
  assert.equal(contract.gates.raceNotStarted, true);
  assert.equal(contract.paperAction.enabled, true);
  assert.equal(contract.quote.asOf, "2026-10-04T17:58:00Z");
});

test("missing model score always abstains even when odds are complete", () => {
  const missingScore = quote({ runners: runners.map((runner) => ({ ...runner, modelProbability: null })) });
  const contract = buildDecisionContract({ race, quote: missingScore, runnerId: "runner-1", settings, now: "2026-10-04T17:59:00Z" });
  assert.equal(contract.decision.status, "ABSTAIN");
  assert.equal(contract.paperAction.enabled, false);
  assert.equal(contract.gates.modelScore, false);
  assert.ok(contract.decision.reasons.includes("MODEL_SCORE_MISSING"));
});

test("quote age is calculated from capture time and never frozen at zero", () => {
  const contract = buildDecisionContract({ race, quote: quote(), runnerId: "runner-1", settings, now: "2026-10-04T18:04:01Z" });
  assert.equal(contract.quoteAgeSeconds, 361);
  assert.equal(contract.decision.status, "ABSTAIN");
  assert.ok(contract.decision.reasons.includes("STALE_QUOTE"));
});

test("a race at or after scheduled off is closed to paper actions", () => {
  const contract = buildDecisionContract({ race, quote: quote(), runnerId: "runner-1", settings, now: "2026-10-04T18:00:00Z" });
  assert.equal(contract.decision.status, "ABSTAIN");
  assert.equal(contract.paperAction.enabled, false);
  assert.equal(contract.gates.raceNotStarted, false);
  assert.ok(contract.decision.reasons.includes("RACE_STARTED"));
});

test("quote ids are stable for duplicate imports", () => {
  const left = quoteSnapshotId(quote());
  const right = quoteSnapshotId({ ...quote(), runners: [...runners].reverse() });
  assert.equal(left, right);
});
