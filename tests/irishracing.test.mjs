import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIrishRacingQuote,
  findIrishRacingCardLink,
  fractionalToDecimal,
  parseIrishRacingOddsXml,
  parseIrishRacingRacecard,
} from "../racing/irishracing.js";
import worker, { clearIrishRacingPageCache } from "../worker.js";

const indexHtml = `
  <a href="/racecards/Sun-20th-Sep-2026/Listowel/1418">2.18 Kinisla Hurdle</a>
  <a href="/racecards/Sun-20th-Sep-2026/Listowel/1448">2.48 Kinisla Hurdle</a>
`;

const racecardHtml = `
  <title>Racecard Listowel, Sun, 20th Sep, 2026, Kinisla Hurdle | irishracing.com</title>
  <div class="row runner-line no-margin-lr col-cnt-padding">
    <div class="col-lg-3"><div class="sn"><strong>1</strong></div></div>
    <div class="col-lg-9"><div class="runner">
      <a id="hxfrm1" href="/horse/Hello-Garda-IRE/838860" class="runner toolTip"><strong>Hello Garda (IRE)</strong></a>
    </div><div class="trainer"><div id="price1" class="price"><span class="bkprice">11/1</span></div></div></div>
  </div>
  <div class="row runner-line no-margin-lr col-cnt-padding">
    <div class="col-lg-3"><div class="sn"><strong>2</strong></div></div>
    <div class="col-lg-9"><div class="runner">
      <a id="hxfrm2" href="/horse/Chairmanforlife-FR/123" class="runner toolTip"><strong>Chairmanforlife (FR)</strong></a>
    </div><div class="trainer"><div id="price2" class="price"><span class="bkprice">4/1</span></div></div></div>
  </div>
`;

const oddsXml = `
  <result status="OK">
    <bookmakers>
      <bookie bid="1" name="Betfair" />
      <bookie bid="3" name="Boylesports" />
    </bookmakers>
    <runners>
      <runner id="horse-1" saddleno="1">
        <prices>
          <price id="1" bt="B" price="2/1" pricedec="3" />
          <price id="3" bt="B" price="5/2" pricedec="3.5" />
          <price id="1" bt="E" price="4.0" pricedec="4" />
        </prices>
      </runner>
      <runner id="horse-2" saddleno="2">
        <prices><price id="3" bt="B" price="4/1" pricedec="5" /></prices>
      </runner>
    </runners>
  </result>
`;

test("converts fractional prices and selects the requested date-specific race", () => {
  assert.equal(fractionalToDecimal("11/1"), 12);
  assert.equal(fractionalToDecimal("EVS"), 2);
  assert.equal(findIrishRacingCardLink(indexHtml, {
    venue: "Listowel",
    scheduledOffAt: "2026-09-20T13:18:00Z",
  }), "https://www.irishracing.com/racecards/Sun-20th-Sep-2026/Listowel/1418");
});

test("parses Irishracing's live odds XML and excludes exchange prices", () => {
  assert.deepEqual(parseIrishRacingOddsXml(oddsXml), [
    { sourceRunnerId: "irishracing:horse-1", number: "1", odds: 3.5, oddsFractional: "5/2", oddsUpdatedAt: null },
    { sourceRunnerId: "irishracing:horse-2", number: "2", odds: 5, oddsFractional: "4/1", oddsUpdatedAt: null },
  ]);
});

test("parses runner names, numbers, prices, and race identity from a public racecard", () => {
  const parsed = parseIrishRacingRacecard(racecardHtml, "https://www.irishracing.com/racecards/Sun-20th-Sep-2026/Listowel/1418");
  assert.equal(parsed.venue, "Listowel");
  assert.equal(parsed.scheduledOffAt, "2026-09-20T13:18:00.000Z");
  assert.deepEqual(parsed.runners.map((runner) => ({ number: runner.number, horseName: runner.horseName, odds: runner.odds })), [
    { number: "1", horseName: "Hello Garda (IRE)", odds: 12 },
    { number: "2", horseName: "Chairmanforlife (FR)", odds: 5 },
  ]);
});

test("maps parsed prices onto Racing API runner ids and fails closed for missing prices", () => {
  const parsed = parseIrishRacingRacecard(racecardHtml, "https://www.irishracing.com/racecards/Sun-20th-Sep-2026/Listowel/1418");
  const quote = buildIrishRacingQuote(parsed, [
    { providerRunnerId: "racing-api:1", number: "1", horseName: "Hello Garda (IRE)" },
    { providerRunnerId: "racing-api:2", number: "2", horseName: "Chairmanforlife (FR)" },
    { providerRunnerId: "racing-api:3", number: "3", horseName: "Missing Runner (IRE)" },
  ], "2026-09-20T13:00:00.000Z");
  assert.equal(quote.provider, "irishracing.com");
  assert.equal(quote.completeBook, false);
  assert.equal(quote.runners[0].runnerId, "racing-api:1");
  assert.equal(quote.runners[0].oddsBookmaker, "Irishracing.com best available");
  assert.equal(quote.runners[2].odds, null);
});

test("loads one selected race from Irishracing and stores a timestamped quote snapshot", { concurrency: false }, async () => {
  clearIrishRacingPageCache();
  const originalFetch = globalThis.fetch;
  const calls = [];
  const liveRacecardHtml = `<script>var selprc="096",selprd="202609201418",selprt="N";</script>${racecardHtml.replace(/<span class="bkprice">[^<]+<\/span>/g, "")}`;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://www.irishracing.com/racecards") return new Response(indexHtml, { status: 200 });
    if (String(url).includes("/odds-comparison?")) return new Response(oddsXml, { status: 200 });
    if (String(url).includes("/racecards/Sun-20th-Sep-2026/Listowel/1418")) return new Response(liveRacecardHtml, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/irishracing-odds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raceId: "racing-api:listowel:1418",
        venue: "Listowel",
        scheduledOffAt: "2026-09-20T13:18:00Z",
        runners: [
          { providerRunnerId: "racing-api:1", number: "1", horseName: "Hello Garda (IRE)" },
          { providerRunnerId: "racing-api:2", number: "2", horseName: "Chairmanforlife (FR)" },
        ],
      }),
    }), { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quote.provider, "irishracing.com");
    assert.equal(body.quote.completeBook, true);
    assert.equal(body.quote.runners[0].runnerId, "racing-api:1");
    assert.deepEqual(body.quote.runners.map((runner) => runner.odds), [3.5, 5]);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads a batch of current races from Irishracing and returns paper decisions", { concurrency: false }, async () => {
  clearIrishRacingPageCache();
  const previousFetch = globalThis.fetch;
  const calls = [];
  const liveRacecardHtml = `<script>var selprc="096",selprd="202609201418",selprt="N";</script>${racecardHtml.replace(/<span class="bkprice">[^<]+<\/span>/g, "")}`;
  const batchIndexHtml = `
    <a href="/racecards/Sun-20th-Sep-2026/Listowel/1418">2.18 Kinisla Hurdle</a>
    <a href="/racecards/Sun-20th-Sep-2026/Listowel/1448">2.48 Kinisla Hurdle</a>
  `;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === "https://www.irishracing.com/racecards") return new Response(batchIndexHtml, { status: 200 });
    if (String(url).includes("/odds-comparison?")) return new Response(oddsXml, { status: 200 });
    if (String(url).includes("/racecards/Sun-20th-Sep-2026/Listowel/1418")) return new Response(liveRacecardHtml, { status: 200 });
    if (String(url).includes("/racecards/Sun-20th-Sep-2026/Listowel/1448")) return new Response(racecardHtml, { status: 200 });
    return new Response("not found", { status: 404 });
  };
  try {
    const response = await worker.fetch(new Request("https://racing.test/api/qvm/racing/irishracing-odds/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        races: [
          { raceId: "batch-race-1418", venue: "Listowel", scheduledOffAt: "2026-09-20T13:18:00Z", runners: [{ providerRunnerId: "batch-1", number: "1", horseName: "Hello Garda (IRE)" }, { providerRunnerId: "batch-2", number: "2", horseName: "Chairmanforlife (FR)" }] },
          { raceId: "batch-race-1448", venue: "Listowel", scheduledOffAt: "2026-09-20T13:48:00Z", runners: [{ providerRunnerId: "batch-3", number: "1", horseName: "Hello Garda (IRE)" }, { providerRunnerId: "batch-4", number: "2", horseName: "Chairmanforlife (FR)" }] }
        ]
      })
    }), { ASSETS: { fetch: () => new Response("not found", { status: 404 }) } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.requested, 2);
    assert.equal(body.loaded, 2);
    assert.equal(body.items.length, 2);
    assert.equal(body.items[0].quote.provider, "irishracing.com");
    assert.ok(["ABSTAIN", "PAPER_CANDIDATE"].includes(body.items[0].paperDecision.decision.status));
    assert.ok(calls.filter((url) => url === "https://www.irishracing.com/racecards").length <= 1);
    assert.ok(calls.filter((url) => url.includes("/racecards/Sun-20th-Sep-2026/Listowel/")).length <= 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
