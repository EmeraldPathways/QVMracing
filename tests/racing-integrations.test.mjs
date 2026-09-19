import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const assets = { fetch: () => new Response("not found", { status: 404 }) };

test("weather endpoint returns the nearest Open-Meteo observation for a race", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.match(String(request), /api\.open-meteo\.com\/v1\/forecast/);
    return new Response(JSON.stringify({
      hourly: {
        time: ["2026-09-19T14:00", "2026-09-19T15:00"],
        temperature_2m: [17.2, 17.8],
        precipitation: [0, 0.4],
        wind_speed_10m: [9, 12]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/weather?latitude=51.41&longitude=0.11&raceTime=2026-09-19T14:20:00Z"), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "open-meteo");
    assert.equal(body.observation.temperature_2m, 17.2);
    assert.equal(body.observation.time, "2026-09-19T14:00");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("weather endpoint falls back to current Open-Meteo data when hourly forecast is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: true, reason: "temporary upstream limit" }), { status: 429 });
    return new Response(JSON.stringify({ current: { time: "2026-09-19T15:00", temperature_2m: 18, precipitation: 0, wind_speed_10m: 10, weather_code: 2 } }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/weather?latitude=51.41&longitude=0.11&raceTime=2026-09-20T10:00:00Z"), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.fallback, "current");
    assert.equal(body.observation.temperature_2m, 18);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fixtures endpoint normalizes The Racing API racecards without exposing credentials", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    assert.match(String(request), /api\.theracingapi\.com\/v1\/racecards\/free/);
    assert.equal(init.headers.authorization, "Basic dGVzdDpzZWNyZXQ=");
    return new Response(JSON.stringify({ racecards: [{
      race_id: "rac_1", course: "Kempton", region: "GB", off_dt: "2026-09-19T14:20:00+01:00",
      distance_round: "1m", going: "Good", surface: "AW", field_size: "6", race_status: "declared",
      runners: [{ horse_id: "hrs_1", horse: "Alpha Meridian", number: "1", form: "123" }]
    }], total: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures?day=today&regions=gb"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "the-racing-api");
    assert.equal(body.fixtures[0].providerRaceId, "rac_1");
    assert.equal(body.fixtures[0].runners[0].horseName, "Alpha Meridian");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fixtures endpoint fails clearly when Racing API credentials are absent", async () => {
  const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures"), { ASSETS: assets });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "RACING_API_NOT_CONFIGURED");
});

test("history endpoint requests date-bounded results for walk-forward research", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.match(String(request), /api\.theracingapi\.com\/v1\/results/);
    assert.match(String(request), /start_date=2026-01-01/);
    assert.match(String(request), /end_date=2026-01-31/);
    return new Response(JSON.stringify({ results: [{ race_id: "rac_1", date: "2026-01-10", course: "Kempton" }], total: 1 }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/history?startDate=2026-01-01&endDate=2026-01-31"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "the-racing-api");
    assert.equal(body.results[0].race_id, "rac_1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("history endpoint falls back to the free same-day results feed when historical access is not included", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ detail: "Standard Plan required" }), { status: 403 });
    assert.match(String(request), /api\.theracingapi\.com\/v1\/results\/today\/free/);
    return new Response(JSON.stringify({ results: [{ race_id: "rac_today", date: "2026-09-19", course: "Ayr" }], total: 1 }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/history?startDate=2026-09-19&endDate=2026-09-19"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "today-free");
    assert.equal(body.results[0].race_id, "rac_today");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
