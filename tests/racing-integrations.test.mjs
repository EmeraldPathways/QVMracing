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
        time: ["2099-09-19T14:00", "2099-09-19T15:00"],
        temperature_2m: [17.2, 17.8],
        precipitation: [0, 0.4],
        wind_speed_10m: [9, 12]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/weather?latitude=51.41&longitude=0.11&raceTime=2099-09-19T14:20:00Z"), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "open-meteo");
    assert.equal(body.observation.temperature_2m, 17.2);
    assert.equal(body.observation.time, "2099-09-19T14:00");
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

test("weather endpoint falls back to a public forecast feed when Open-Meteo is rate limited", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    if (calls < 3) return new Response(JSON.stringify({ reason: "Daily API request limit exceeded" }), { status: 429 });
    assert.match(String(request), /api\.met\.no\/weatherapi\/locationforecast\/2\.0\/compact/);
    return new Response(JSON.stringify({ properties: { timeseries: [{ time: "2026-09-20T10:00:00Z", data: { instant: { details: { air_temperature: 16.5, relative_humidity: 72, wind_speed: 4, wind_from_direction: 210 } }, next_1_hours: { details: { precipitation_amount: 0.2 } } } }] } }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/weather?latitude=51.41&longitude=0.11&raceTime=2026-09-20T10:00:00Z"), { ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "met.no");
    assert.equal(body.fallback, "met-no");
    assert.equal(body.observation.temperature_2m, 16.5);
    assert.equal(body.observation.wind_speed_10m, 14.4);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fixtures endpoint normalizes The Racing API racecards without exposing credentials", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    assert.match(String(request), /api\.theracingapi\.com\/v1\/racecards\/standard/);
    assert.equal(init.headers.authorization, "Basic dGVzdDpzZWNyZXQ=");
    return new Response(JSON.stringify({ racecards: [{
      race_id: "rac_1", course: "Kempton", region: "GB", off_dt: "2026-09-19T14:20:00+01:00",
      distance_round: "1m", going: "Good", surface: "AW", field_size: "6", race_status: "declared",
      runners: [
        { horse_id: "hrs_1", horse: "Alpha Meridian", number: "1", form: "123", odds: [{ bookmaker: "Bookmaker A", decimal: "3.5", updated: "2026-09-19 14:18:00" }, { bookmaker: "Bookmaker B", decimal: "3.2", updated: "2026-09-19 14:17:00" }] },
        { horse_id: "hrs_2", horse: "Second Runner", number: "2", form: "234", odds: [{ bookmaker: "Bookmaker A", decimal: "4.2", updated: "2026-09-19 14:18:00" }] },
        { horse_id: "hrs_3", horse: "Third Runner", number: "3", form: "345", odds: [{ bookmaker: "Bookmaker A", decimal: "5.0", updated: "2026-09-19 14:18:00" }] },
        { horse_id: "hrs_4", horse: "Fourth Runner", number: "4", form: "456", odds: [{ bookmaker: "Bookmaker A", decimal: "7.0", updated: "2026-09-19 14:18:00" }] }
      ]
    }], total: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures?day=today&regions=gb"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "the-racing-api");
    assert.equal(body.fixtures[0].providerRaceId, "rac_1");
    assert.equal(body.fixtures[0].runners[0].horseName, "Alpha Meridian");
    assert.equal(body.fixtures[0].runners[0].odds, 3.5);
    assert.equal(body.fixtures[0].runners[0].oddsBookmaker, "Bookmaker A");
    assert.equal(body.fixtures[0].quoteAgeSeconds, 0);
    assert.equal(body.fixtures[0].paperDecision.decision.status, "ABSTAIN");
    assert.ok(body.fixtures[0].paperDecision.decision.reasons.includes("MODEL_SCORE_MISSING"));
    assert.equal(body.evidence.completeRunnerBooks, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fixtures endpoint loads today and tomorrow, labels each race day, and deduplicates races", async () => {
  const previousFetch = globalThis.fetch;
  const requestedDays = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    assert.equal(init.headers.authorization, "Basic dGVzdDpzZWNyZXQ=");
    requestedDays.push(url.searchParams.get("day"));
    const racecards = url.searchParams.get("day") === "today"
      ? [
        { race_id: "shared_race", course: "Ayr", region: "GB", off_dt: "2026-09-20T14:00:00Z", runners: [{ horse_id: "a1", horse: "Today Alpha" }, { horse_id: "a2", horse: "Today Beta" }] },
        { race_id: "today_race", course: "Kempton", region: "GB", off_dt: "2026-09-20T15:00:00Z", runners: [{ horse_id: "b1", horse: "Today Gamma" }, { horse_id: "b2", horse: "Today Delta" }] }
      ]
      : [
        { race_id: "shared_race", course: "Ayr", region: "GB", off_dt: "2026-09-20T14:00:00Z", runners: [{ horse_id: "a1", horse: "Today Alpha" }, { horse_id: "a2", horse: "Today Beta" }] },
        { race_id: "tomorrow_race", course: "Listowel", region: "IE", off_dt: "2026-09-21T16:18:00Z", runners: [{ horse_id: "c1", horse: "Tomorrow Alpha" }, { horse_id: "c2", horse: "Tomorrow Beta" }] }
      ];
    return new Response(JSON.stringify({ racecards, total: racecards.length }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures?days=today,tomorrow&regions=gb,ire"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(requestedDays, ["today", "tomorrow"]);
    assert.deepEqual(body.days, ["today", "tomorrow"]);
    assert.equal(body.total, 3);
    assert.deepEqual(body.fixtures.map((fixture) => fixture.fixtureDay), ["today", "today", "tomorrow"]);
    assert.deepEqual(body.fixtures.map((fixture) => fixture.providerRaceId), ["shared_race", "today_race", "tomorrow_race"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("fixtures endpoint falls back to free cards when the odds plan is unavailable", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    if (calls === 1) {
      assert.match(String(request), /api\.theracingapi\.com\/v1\/racecards\/standard/);
      return new Response(JSON.stringify({ message: "Standard plan required" }), { status: 503 });
    }
    assert.match(String(request), /api\.theracingapi\.com\/v1\/racecards\/free/);
    return new Response(JSON.stringify({ racecards: [{ race_id: "free_1", course: "Ayr", region: "GB", off_dt: "2026-09-20T15:00:00Z", runners: [{ horse_id: "free_horse_1", horse: "Free Alpha" }, { horse_id: "free_horse_2", horse: "Free Beta" }] }], total: 1 }), { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures?day=today&regions=gb"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.evidence.oddsAvailable, false);
    assert.match(body.evidence.notice, /Standard plan/);
    assert.equal(body.fixtures[0].paperDecision.dataMode, "ODDS_UNAVAILABLE");
    assert.equal(body.fixtures[0].quoteAgeSeconds, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("free-feed fallback labels a card by its scheduled UTC date", async () => {
  const previousFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ message: "Standard plan required" }), { status: 503 });
    assert.match(String(request), /api\.theracingapi\.com\/v1\/racecards\/free/);
    return new Response(JSON.stringify({ racecards: [{ race_id: "free_today_1", course: "Ayr", region: "GB", off_dt: `${today}T23:59:00Z`, runners: [{ horse_id: "free_today_horse_1", horse: "Free Today Alpha" }, { horse_id: "free_today_horse_2", horse: "Free Today Beta" }] }], total: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/fixtures?day=tomorrow&regions=gb"), { RACING_API_USERNAME: "test", RACING_API_PASSWORD: "secret", ASSETS: assets });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.fixtures[0].fixtureDay, "today");
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
