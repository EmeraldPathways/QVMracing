import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };
const request = (path, init) => worker.fetch(new Request("https://racing.test" + path, init), env);

test("quote snapshots are validated, stored, and exposed to live decisions", async () => {
  const capturedAt = new Date(Date.now() - 1000).toISOString();
  const response = await request("/api/qvm/racing/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "upgrade-quote-1",
      raceId: "upgrade-race-1",
      provider: "test-provider",
      capturedAt,
      sourceUpdatedAt: capturedAt,
      runners: [
        { runnerId: "demo:horse:1", horseName: "Alpha Meridian", odds: 3.2 },
        { runnerId: "upgrade:horse:2", horseName: "Second Runner", odds: 4.1 }
      ]
    })
  });
  assert.equal(response.status, 201);
  const list = await request("/api/qvm/racing/quotes?raceId=upgrade-race-1");
  assert.equal((await list.json()).snapshots[0].id, "upgrade-quote-1");
  const decision = await request("/api/qvm/racing/decision");
  const decisionBody = await decision.json();
  assert.equal(decisionBody.dataMode, "LIVE_QUOTE_SNAPSHOT");
  assert.equal(decisionBody.quote.id, "upgrade-quote-1");
  assert.ok(Array.isArray(decisionBody.provenance.features));
});

test("settings, notes, filters, alerts, imports, and replay remain hosted", async () => {
  const settings = await request("/api/qvm/racing/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bankroll: 1250, maxStakePct: .04, minDataQuality: 72 })
  });
  assert.equal(settings.status, 200);
  assert.equal((await settings.json()).settings.bankroll, 1250);

  const note = await request("/api/qvm/racing/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceId: "upgrade-race-1", note: "Pre-race evidence note." })
  });
  assert.equal(note.status, 201);
  assert.equal((await note.json()).raceId, "upgrade-race-1");

  const filter = await request("/api/qvm/racing/filters", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "GB morning", filter: { region: "gb", status: "scheduled" } })
  });
  assert.equal(filter.status, 201);

  const alert = await request("/api/qvm/racing/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "TEST", title: "Test alert", message: "Acknowledge me." })
  });
  assert.equal(alert.status, 201);
  const alertBody = await alert.json();
  const acknowledged = await request("/api/qvm/racing/alerts/ack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: alertBody.id })
  });
  assert.equal(acknowledged.status, 200);

  const watched = await request("/api/qvm/racing/watchlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceId: "upgrade-race-1", label: "Review later", active: true })
  });
  assert.equal(watched.status, 201);
  assert.equal((await (await request("/api/qvm/racing/watchlist")).json()).watchlist[0].raceId, "upgrade-race-1");
  const lifecycle = await request("/api/qvm/racing/lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceId: "upgrade-race-1", status: "DELAYED", reason: "Weather check" })
  });
  assert.equal(lifecycle.status, 201);
  assert.equal((await (await request("/api/qvm/racing/lifecycle?raceId=upgrade-race-1")).json()).lifecycle[0].status, "DELAYED");

  const imported = await request("/api/qvm/racing/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "results",
      records: [{ id: "upgrade-result-1", raceId: "upgrade-race-1", capturedAt: new Date(Date.now() - 2000).toISOString(), course: "Kempton", winner: "Alpha Meridian" }]
    })
  });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).accepted, 1);
  const results = await request("/api/qvm/racing/results");
  assert.ok((await results.json()).results.some((item) => item.id === "upgrade-result-1"));

  const snapshot = await request("/api/qvm/racing/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runnerId: "demo:horse:1" })
  });
  const snapshotBody = await snapshot.json();
  const replay = await request("/api/qvm/racing/replay?snapshotId=" + encodeURIComponent(snapshotBody.id));
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).deterministic, true);
});
