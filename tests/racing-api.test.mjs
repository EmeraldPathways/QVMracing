import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { QVM_RACING_WORKER_SHARED_SECRET: "secret", ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };
test("public racing API returns stable overview and rejects unauthorized sync", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/overview"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paperOnly, true);
  const denied = await worker.fetch(new Request("https://racing.test/api/qvm/racing/worker/sync", { method: "POST", body: JSON.stringify({ cycleId: "x" }) }), env);
  assert.equal(denied.status, 401);
});
