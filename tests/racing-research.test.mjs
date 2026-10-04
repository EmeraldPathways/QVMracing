import test from "node:test";
import assert from "node:assert/strict";
import { favouriteBaseline, marketBaseline, priceSensitivity, sampleStatus } from "../racing/research.js";

test("research baselines stay explicitly insufficient below the sample threshold", () => {
  const records = [{ odds: 3, outcome: "WON", createdAt: "2026-01-01T10:00:00Z" }];
  assert.equal(sampleStatus(1), "INSUFFICIENT_DATA");
  assert.equal(marketBaseline(records).sampleStatus, "INSUFFICIENT_DATA");
  assert.equal(favouriteBaseline(records).sampleStatus, "INSUFFICIENT_DATA");
});

test("price sensitivity shows the effect of a five percent price move", () => {
  const result = priceSensitivity({ probability: .4, odds: 3.5 });
  assert.equal(result.status, "AVAILABLE");
  assert.ok(result.minusFivePct < result.current);
  assert.ok(result.plusFivePct > result.current);
});
