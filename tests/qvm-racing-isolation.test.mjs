import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("racing worker contains no live execution method or football endpoint", async () => {
  const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /placeOrder|submitBet|cancelOrder|\/api\/qvm\/worker\/sync/);
  assert.doesNotMatch(worker, /ODDS_API_URL|QVM_SITE_URL|QVM_WORKER_SHARED_SECRET/);
});
