import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } };
const request = (path, init = {}, visitor = "trust-test") => worker.fetch(new Request("https://racing.test" + path, {
  ...init,
  headers: { "x-qvm-visitor-id": visitor, ...(init.headers || {}) },
}), env);
const jsonInit = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function quoteBody(raceId, overrides = {}) {
  return {
    id: overrides.id,
    raceId,
    venue: "Contract Park",
    scheduledOffAt: "2099-10-04T18:00:00Z",
    provider: "contract-test",
    capturedAt: new Date(Date.now() - 120_000).toISOString(),
    sourceUpdatedAt: new Date(Date.now() - 150_000).toISOString(),
    completeBook: true,
    runners: [
      { runnerId: `${raceId}:1`, horseName: "Alpha", odds: 3.5, modelProbability: .4, status: "DECLARED" },
      { runnerId: `${raceId}:2`, horseName: "Beta", odds: 4.5, modelProbability: .2, status: "DECLARED" },
      { runnerId: `${raceId}:3`, horseName: "Gamma", odds: 6, modelProbability: .1, status: "DECLARED" },
      { runnerId: `${raceId}:4`, horseName: "Delta", odds: 8, modelProbability: .08, status: "DECLARED" },
    ],
    ...overrides,
  };
}

test("missing model score blocks a direct paper API request", async () => {
  const raceId = "strict-missing-model";
  const body = quoteBody(raceId, { id: "strict-missing-model-quote", runners: quoteBody(raceId).runners.map((runner) => ({ ...runner, modelProbability: null })) });
  assert.equal((await request("/api/qvm/racing/quotes", jsonInit(body))).status, 201);
  const decision = await (await request(`/api/qvm/racing/decision?raceId=${raceId}&runnerId=${encodeURIComponent(`${raceId}:1`)}`)).json();
  assert.equal(decision.decision.status, "ABSTAIN");
  assert.ok(decision.decision.reasons.includes("MODEL_SCORE_MISSING"));
  const paper = await request("/api/qvm/racing/paper-positions", jsonInit({ raceId, runnerId: `${raceId}:1` }));
  assert.equal(paper.status, 409);
  assert.equal((await paper.json()).error, "NOT_ACTIONABLE");
});

test("old quotes and off races are both closed by the server contract", async () => {
  const oldRace = "strict-old-quote";
  const old = quoteBody(oldRace, { id: "strict-old-quote-snapshot", capturedAt: "2026-10-04T10:00:00Z", sourceUpdatedAt: "2026-10-04T10:00:00Z" });
  assert.equal((await request("/api/qvm/racing/quotes", jsonInit(old))).status, 201);
  const oldDecision = await (await request(`/api/qvm/racing/decision?raceId=${oldRace}&runnerId=${oldRace}:1`)).json();
  assert.equal(oldDecision.decision.status, "ABSTAIN");
  assert.ok(oldDecision.decision.reasons.includes("STALE_QUOTE"));

  const pastRace = "strict-past-race";
  const past = quoteBody(pastRace, { id: "strict-past-quote", scheduledOffAt: "2026-10-04T12:00:00Z", capturedAt: "2026-10-04T11:59:00Z", sourceUpdatedAt: "2026-10-04T11:58:00Z" });
  assert.equal((await request("/api/qvm/racing/quotes", jsonInit(past))).status, 201);
  const pastDecision = await (await request(`/api/qvm/racing/decision?raceId=${pastRace}&runnerId=${pastRace}:1`)).json();
  assert.equal(pastDecision.decision.status, "ABSTAIN");
  assert.ok(pastDecision.decision.reasons.includes("RACE_STARTED"));
});

test("duplicate quote import is idempotent and visitor ledgers stay isolated", async () => {
  const raceId = "strict-idempotent-race";
  const body = quoteBody(raceId);
  const first = await request("/api/qvm/racing/quotes", jsonInit(body), "visitor-a");
  const second = await request("/api/qvm/racing/quotes", jsonInit(body), "visitor-b");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const quotes = await (await request(`/api/qvm/racing/quotes?raceId=${raceId}`)).json();
  assert.equal(quotes.snapshots.length, 1);

  const paper = await request("/api/qvm/racing/paper-positions", jsonInit({ raceId, runnerId: `${raceId}:1` }), "visitor-a");
  assert.equal(paper.status, 201);
  const visitorAPositions = await (await request("/api/qvm/racing/paper-positions", {}, "visitor-a")).json();
  const visitorBPositions = await (await request("/api/qvm/racing/paper-positions", {}, "visitor-b")).json();
  assert.equal(visitorAPositions.positions.length, 1);
  assert.equal(visitorBPositions.positions.length, 0);

  assert.equal((await request("/api/qvm/racing/watchlist", jsonInit({ raceId, active: true }), "visitor-a")).status, 201);
  const visitorAWatchlist = await (await request("/api/qvm/racing/watchlist", {}, "visitor-a")).json();
  const visitorBWatchlist = await (await request("/api/qvm/racing/watchlist", {}, "visitor-b")).json();
  assert.equal(visitorAWatchlist.watchlist.length, 1);
  assert.equal(visitorBWatchlist.watchlist.length, 0);

  const ambiguous = await request("/api/qvm/racing/settle", jsonInit({ positionId: visitorAPositions.positions[0].id }), "visitor-a");
  assert.equal(ambiguous.status, 400);
  assert.equal((await ambiguous.json()).error, "AMBIGUOUS_OUTCOME");
});
