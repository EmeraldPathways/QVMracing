import test from "node:test";
import assert from "node:assert/strict";
import schema from "../contracts/qvm-racing-sync.schema.json" with { type: "json" };
import decisionSchema from "../contracts/qvm-racing-decision.schema.json" with { type: "json" };

test("racing contract declares version and required arrays", () => {
  assert.equal(schema.properties.schemaVersion.const, "qvm-racing-sync.v1");
  for (const key of ["races", "runners", "quotes", "predictions", "paperPositions", "agentRuns", "heartbeat"]) assert.ok(schema.required.includes(key));
});

test("decision contract requires an explicit paper action and server gates", () => {
  assert.equal(decisionSchema.properties.contractVersion.const, "qvm-racing-decision.v2");
  for (const key of ["race", "runner", "decision", "gates", "paperAction", "quote", "source", "capturedAt", "modelVersion"]) assert.ok(decisionSchema.required.includes(key));
});
