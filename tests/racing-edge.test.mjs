import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBook, edgeDecision, closingLineValue } from "../racing/edge.js";

test("normalizes a complete race book and exposes overround", () => {
  const result = normalizeBook([{ runnerId: "a", odds: 2 }, { runnerId: "b", odds: 3 }, { runnerId: "c", odds: 4 }]);
  assert.equal(result.complete, true);
  assert.equal(result.overround, 1.0833);
  assert.equal(result.runners[0].noVigProbability, 0.4615);
});

test("rejects incomplete or invalid books", () => {
  assert.equal(normalizeBook([{ runnerId: "a", odds: 2 }]).complete, false);
  assert.equal(normalizeBook([{ runnerId: "a", odds: 0 }]).reason, "INVALID_ODDS");
});

test("fails closed when quote is stale or evidence quality is weak", () => {
  const result = edgeDecision({ modelProbability: .4, odds: 3, marketProbability: .3, quoteAgeSeconds: 301, dataQuality: 69, uncertainty: .1 });
  assert.equal(result.status, "ABSTAIN");
  assert.deepEqual(result.reasons.sort(), ["LOW_DATA_QUALITY", "STALE_QUOTE"]);
});

test("calculates fair odds, expected value, and a paper candidate", () => {
  const result = edgeDecision({ modelProbability: .4, odds: 3, marketProbability: .3, quoteAgeSeconds: 30, dataQuality: 90, uncertainty: .08, costRate: .02 });
  assert.equal(result.status, "PAPER_CANDIDATE");
  assert.equal(result.fairOdds, 2.5);
  assert.equal(result.expectedValue, .18);
  assert.equal(result.gates.positiveEdge, true);
});

test("measures positive closing-line value when odds shorten", () => {
  assert.equal(closingLineValue(3.5, 3), .1667);
});
