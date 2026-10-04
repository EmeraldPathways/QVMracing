import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { QVM_RACING_WORKER_SHARED_SECRET: "test-secret", ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };

test("racing worker exposes overview and scan endpoints", async () => {
  const overview = await worker.fetch(new Request("https://racing.test/api/qvm/racing/overview"), env);
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).paperOnly, true);
  const scan = await worker.fetch(new Request("https://racing.test/api/qvm/racing/scan"), env);
  assert.equal((await scan.json()).candidates[0].action, "ABSTAIN");
});

test("paper positions cannot be created without a race-owned candidate decision", async () => {
  const before = await worker.fetch(new Request("https://racing.test/api/qvm/racing/paper-positions"), env);
  assert.equal(before.status, 200);
  assert.ok(Array.isArray((await before.json()).positions));
  const created = await worker.fetch(new Request("https://racing.test/api/qvm/racing/paper-positions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runnerId: "demo:horse:1" })
  }), env);
  assert.equal(created.status, 409);
  assert.equal((await created.clone().json()).error, "RACE_ID_REQUIRED");
  const after = await worker.fetch(new Request("https://racing.test/api/qvm/racing/paper-positions"), env);
  const positions = (await after.json()).positions;
  assert.equal(positions.length, 0);
});

test("complete provider quotes can produce a real-runner decision and paper position", async () => {
  const raceId = "provider-race-paper-test";
  const capturedAt = new Date().toISOString();
  const runners = [
    { runnerId: "provider:horse:1", horseName: "Live Alpha", odds: 3.5, modelProbability: .4, status: "DECLARED" },
    { runnerId: "provider:horse:2", horseName: "Live Beta", odds: 4.2, modelProbability: .2, status: "DECLARED" },
    { runnerId: "provider:horse:3", horseName: "Live Gamma", odds: 5, modelProbability: .1, status: "DECLARED" },
    { runnerId: "provider:horse:4", horseName: "Live Delta", odds: 7, modelProbability: .08, status: "DECLARED" }
  ];
  const quote = await worker.fetch(new Request("https://racing.test/api/qvm/racing/quotes", {
    method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ raceId, venue: "Test Park", scheduledOffAt: "2099-09-20T16:00:00Z", provider: "the-racing-api", capturedAt, sourceUpdatedAt: capturedAt, runners })
  }), env);
  assert.equal(quote.status, 201);
  const decision = await worker.fetch(new Request(`https://racing.test/api/qvm/racing/decision?raceId=${raceId}&runnerId=provider%3Ahorse%3A1`), env);
  assert.equal(decision.status, 200);
  const decisionBody = await decision.json();
  assert.equal(decisionBody.runner.runnerId, "provider:horse:1");
  assert.equal(decisionBody.decision.status, "PAPER_CANDIDATE");
  const created = await worker.fetch(new Request("https://racing.test/api/qvm/racing/paper-positions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ runnerId: "provider:horse:1", raceId })
  }), env);
  assert.equal(created.status, 201);
  const position = await created.json();
  assert.equal(position.runnerId, "provider:horse:1");
  assert.equal(position.raceId, raceId);
  assert.equal(position.evidenceMode, "LIVE_PROVIDER_QUOTE");
});

test("hosted app does not expose a local worker sync contract", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/worker/sync", { method: "POST" }), env);
  assert.equal(response.status, 404);
});

test("hosted OpenAI route reports configuration honestly", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Explain the current race data." })
  }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "OPENAI_NOT_CONFIGURED");
});

test("hosted OpenAI route uses the configured model and medium reasoning", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: "Hosted answer" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Explain the race." })
    }), { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5-mini", OPENAI_REASONING_EFFORT: "medium", ASSETS: { fetch: () => new Response("not found", { status: 404 }) } });
    assert.equal(response.status, 200);
    assert.equal(requestBody.model, "gpt-5-mini");
    assert.equal(requestBody.reasoning.effort, "medium");
    assert.equal((await response.json()).answer, "Hosted answer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted OpenAI route extracts text from a structured Responses API payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: [{ type: "message", content: [{ type: "output_text", text: "Structured hosted answer" }] }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Explain the race." })
    }), { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5.6-luna", OPENAI_REASONING_EFFORT: "medium", ASSETS: { fetch: () => new Response("not found", { status: 404 }) } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, "Structured hosted answer");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted OpenAI route receives live fixtures and stored odds evidence", async () => {
  const originalFetch = globalThis.fetch;
  const raceId = "ai-context-race";
  const aiEnv = { ...env, OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-5.6-luna", OPENAI_REASONING_EFFORT: "medium", RACING_API_USERNAME: "test-user", RACING_API_PASSWORD: "test-password" };
  await worker.fetch(new Request("https://racing.test/api/qvm/racing/quotes", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ raceId, venue: "Context Park", scheduledOffAt: "2026-09-20T16:00:00Z", provider: "the-racing-api", capturedAt: "2026-09-20T20:00:00Z", sourceUpdatedAt: "2026-09-20T19:59:30Z", runners: [{ runnerId: "stored:1", horseName: "Stored Alpha", odds: 3.75, status: "DECLARED" }, { runnerId: "stored:2", horseName: "Stored Beta", odds: 5.5, status: "DECLARED" }] })
  }), aiEnv);
  let requestBody;
  const requestedDays = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    if (url.hostname === "api.theracingapi.com") {
      requestedDays.push(url.searchParams.get("day"));
      return new Response(JSON.stringify({ racecards: [{ race_id: "live-context-race", course: "Live Park", region: "GB", race_name: "Live Evidence Stakes", off_dt: "2026-09-20T20:30:00Z", going: "Good", runners: [{ horse_id: "live:1", horse: "Live Alpha", odds: [{ bookmaker: "Context Book", decimal: "2.8", updated: "2026-09-20 20:20:00" }] }, { horse_id: "live:2", horse: "Live Beta", odds: [{ bookmaker: "Context Book", decimal: "4.6", updated: "2026-09-20 20:20:00" }] }] }], total: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: "Context-aware answer" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/ai", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Use the current live odds and stored quote evidence to explain this race." })
    }), aiEnv);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, "Context-aware answer");
    assert.deepEqual(requestedDays, ["today", "tomorrow"]);
    const serializedInput = JSON.stringify(requestBody.input);
    assert.match(serializedInput, /Live Evidence Stakes/);
    assert.match(serializedInput, /Live Alpha/);
    assert.match(serializedInput, /Stored Alpha/);
    assert.match(serializedInput, /3\.75/);
    assert.match(serializedInput, /the-racing-api/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("decision endpoint returns a fail-closed evidence decision", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/decision"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.modelVersion, "racing-logit-v2");
  assert.ok(["PAPER_CANDIDATE", "ABSTAIN"].includes(body.decision.status));
  assert.ok(Array.isArray(body.decision.reasons));
  assert.ok(body.decision.gates);
});

test("paper decisions create server-owned evidence snapshots", async () => {
  const created = await worker.fetch(new Request("https://racing.test/api/qvm/racing/snapshots", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runnerId: "demo:horse:1" })
  }), {});
  assert.equal(created.status, 201);
  const snapshot = await created.json();
  assert.match(snapshot.id, /^snapshot-/);
  assert.equal(snapshot.modelVersion, "racing-logit-v2");
  assert.equal(snapshot.runnerId, "demo:horse:1");
  assert.ok(snapshot.decision);
  assert.equal(snapshot.modelProbability, .34);
  const list = await worker.fetch(new Request("https://racing.test/api/qvm/racing/snapshots"), {});
  assert.ok((await list.json()).snapshots.length >= 1);
});

test("market movement reports missing closing price without fabricating CLV", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/market-movement?runnerId=demo:horse:1"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sampleStatus, "INSUFFICIENT_DATA");
  assert.equal(body.closingLineValue, null);
});

test("performance reports calibration, drawdown, and sample status", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/performance"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sampleStatus, "INSUFFICIENT_DATA");
  assert.ok("brierScore" in body);
  assert.ok("logLoss" in body);
  assert.ok("drawdown" in body);
  assert.ok(Array.isArray(body.calibrationBins));
});
