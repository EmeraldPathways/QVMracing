import test from "node:test";
import assert from "node:assert/strict";
import { brierScore, logLoss, calibrationBins, drawdown } from "../racing/metrics.js";

test("calculates multiclass Brier score and log loss", () => {
  assert.equal(brierScore([.7, .2, .1], 0), .14);
  assert.equal(logLoss(.7), .3567);
});

test("builds calibration bins from predicted probabilities and outcomes", () => {
  const bins = calibrationBins([{ probability: .2, outcome: 0 }, { probability: .3, outcome: 1 }, { probability: .8, outcome: 1 }, { probability: .9, outcome: 0 }], 2);
  assert.deepEqual(bins.map((bin) => bin.count), [2, 2]);
  assert.equal(bins[0].observedRate, .5);
  assert.equal(bins[1].observedRate, .5);
});

test("calculates peak-to-trough drawdown", () => {
  assert.equal(drawdown([10, -4, -8, 5]), 12);
});
