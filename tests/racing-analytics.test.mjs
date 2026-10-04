import test from "node:test";
import assert from "node:assert/strict";
import { calculateStake, dataQualityScore, equitySeries, featureProvenance, marketBlend, oddsMovement, segmentCalibration, validateQuoteSnapshot } from "../racing/analytics.js";

test("validates a complete timestamped runner quote snapshot", () => {
  const result = validateQuoteSnapshot({
    raceId: "race-1",
    capturedAt: "2026-09-20T10:00:00Z",
    runners: [{ runnerId: "a", odds: 3 }, { runnerId: "b", odds: 4 }]
  });
  assert.equal(result.valid, true);
  assert.equal(result.runnerCount, 2);
});

test("rejects duplicate, invalid, and future quote records", () => {
  const result = validateQuoteSnapshot({ raceId: "race-1", capturedAt: "2099-01-01T00:00:00Z", runners: [{ runnerId: "a", odds: 3 }, { runnerId: "a", odds: 4 }] }, "2026-09-20T10:00:00Z");
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["CAPTURED_AT_IN_FUTURE", "DUPLICATE_RUNNER", "INCOMPLETE_BOOK"]);
});

test("calculates quarter-Kelly stake inside total and fixture exposure caps", () => {
  const result = calculateStake({ probability: .4, odds: 3.2, bankroll: 1000, maxStakePct: .1, maxTotalExposurePct: .3, maxFixtureExposurePct: .1, openExposure: 200, fixtureExposure: 0 });
  assert.equal(result.allowed, true);
  assert.equal(result.stake, 31.82);
  const blocked = calculateStake({ probability: .4, odds: 3.2, bankroll: 1000, maxStakePct: .1, maxTotalExposurePct: .3, maxFixtureExposurePct: .1, openExposure: 300, fixtureExposure: 0 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "TOTAL_EXPOSURE_CAP");
});

test("blends model and market probabilities without changing the market baseline when weight is zero", () => {
  assert.equal(marketBlend({ modelProbability: .5, marketProbability: .3, modelWeight: 0 }), .3);
  assert.equal(marketBlend({ modelProbability: .5, marketProbability: .3, modelWeight: .5 }), .4);
});

test("groups calibration by race segment and reports observed rate", () => {
  const report = segmentCalibration([
    { segment: "AW|SPRINT", probability: .6, outcome: 1 },
    { segment: "AW|SPRINT", probability: .8, outcome: 0 },
    { segment: "TURF|STAY", probability: .4, outcome: 1 }
  ]);
  assert.equal(report["AW|SPRINT"].count, 2);
  assert.equal(report["AW|SPRINT"].observedRate, .5);
});

test("builds odds movement and paper equity series", () => {
  assert.deepEqual(oddsMovement([{ odds: 4, capturedAt: "2026-09-20T10:02:00Z" }, { odds: 5, capturedAt: "2026-09-20T10:00:00Z" }]).map((row) => row.odds), [5, 4]);
  const series = equitySeries([{ pnl: 10, createdAt: "2026-09-20T10:00:00Z" }, { pnl: -15, createdAt: "2026-09-20T11:00:00Z" }]);
  assert.equal(series.at(-1).equity, -5);
  assert.equal(series.at(-1).drawdown, 15);
});

test("scores evidence quality from completeness and freshness", () => {
  assert.equal(dataQualityScore({ runnerCount: 8, completeBook: true, quoteAgeSeconds: 20, sourceTimestamp: true, weatherLoaded: true }), 100);
  assert.ok(dataQualityScore({ runnerCount: 2, completeBook: false, quoteAgeSeconds: 500, sourceTimestamp: false, weatherLoaded: false }) < 70);
});

test("excludes withdrawn runners and records feature provenance", () => {
  const quote = validateQuoteSnapshot({
    raceId: "race-withdrawal",
    capturedAt: "2026-09-20T10:00:00Z",
    runners: [{ runnerId: "a", odds: 3 }, { runnerId: "b", odds: 4 }, { runnerId: "nr", odds: 2, status: "WITHDRAWN" }]
  });
  assert.equal(quote.valid, true);
  assert.equal(quote.runnerCount, 2);
  const provenance = featureProvenance({ race: { venue: "Kempton", going: "Good", provider: "racing-api" }, modelVersion: "racing-logit-v1", cutoffAt: "2026-09-20T10:00:00Z" });
  assert.equal(provenance.features.find((feature) => feature.name === "course").source, "racing-api");
  assert.equal(provenance.features.find((feature) => feature.name === "trainer_jockey_form").available, false);
});
