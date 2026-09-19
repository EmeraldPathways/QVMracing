import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { QVM_RACING_WORKER_SHARED_SECRET: "test-secret", ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };

test("racing worker exposes overview and scan endpoints", async () => {
  const overview = await worker.fetch(new Request("https://racing.test/api/qvm/racing/overview"), env);
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).paperOnly, true);
  const scan = await worker.fetch(new Request("https://racing.test/api/qvm/racing/scan"), env);
  assert.equal((await scan.json()).candidates[0].action, "PAPER_CANDIDATE");
});

test("worker sync authenticates and is idempotent", async () => {
  const body = JSON.stringify({ cycleId: "cycle-test", counts: { races: 1 } });
  const first = await worker.fetch(new Request("https://racing.test/api/qvm/racing/worker/sync", { method: "POST", headers: { "x-qvm-racing-worker-key": "test-secret", "content-type": "application/json" }, body }), env);
  const second = await worker.fetch(new Request("https://racing.test/api/qvm/racing/worker/sync", { method: "POST", headers: { "x-qvm-racing-worker-key": "test-secret", "content-type": "application/json" }, body }), env);
  assert.equal(first.status, 201);
  assert.equal((await second.json()).idempotent, true);
});
