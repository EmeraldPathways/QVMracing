import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("racing UI keeps paper-only vocabulary and required evidence fields", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const text = html + js;
  for (const required of ["QVM Racing Workbench", "PAPER ONLY", "Quote age", "Model probability", "No-vig market", "Fair odds", "Current odds", "After-cost EV", "Data quality", "Evidence-first workflow", "OpenAI", "The Racing API", "Historical validation", "/api/qvm/racing/fixtures", "/api/qvm/racing/paper-positions", "/api/qvm/racing/ai", "data-filter", "aria-live", "Closing-line value", "Brier score", "walk-forward"]) assert.match(text, new RegExp(required.replace(/[+]/g, "\\+")));
  assert.doesNotMatch(text, /Place live bet|Submit order|Dixon.Coles|home\/draw\/away/i);
});

test("mobile navigation exposes an accessible collapsible drawer", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="mobileSidebarToggle"/);
  assert.match(js, /#sidebarToggle, #mobileSidebarToggle/);
  assert.match(js, /matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /sidebar-collapsed \.sidebar\{[^}]*transform:translateX\(-105%\)/);
  assert.match(css, /mobile-sidebar-toggle\{display:grid/);
});

test("race finder exposes a paper bet control with a safe blocked state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const decisionCard = js.match(/function decisionCard\(\) \{[\s\S]*?\n\}\n\nfunction raceRow/)[0];
  const raceDetail = js.match(/function raceDetail\(race\) \{[\s\S]*?\n\}\n\nfunction raceFinder/)[0];
  assert.match(js, /function paperBetControl\(/);
  assert.match(js, /Paper bet unavailable/);
  assert.match(js, /data-place-paper/);
  assert.match(decisionCard, /paperBetControl\(/);
  assert.match(raceDetail, /paperBetControl\(/);
});

test("race finder marks races with recorded paper positions", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const raceRow = js.match(/function raceRow\(race\) \{[\s\S]*?\n\}\n\nfunction alertsCard/)[0];
  const createPosition = js.match(/async function createPaperPosition\([^)]*\) \{[\s\S]*?\n\}/)[0];
  assert.match(js, /function raceHasPaperBet\(race\)/);
  assert.match(raceRow, /PAPER BET/);
  assert.match(raceRow, /raceHasPaperBet\(race\)/);
  assert.match(createPosition, /raceId/);
});

test("race finder explains when the odds plan is unavailable", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /fixtureEvidence/);
  assert.match(js, /Live odds feed needs attention/);
  assert.match(js, /Paper bets stay disabled/);
});

test("race finder loads two days and uses populated day, venue, and race filters", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /fixtures\?days=today,tomorrow&regions=gb,ire/);
  assert.match(js, /data-filter="day"/);
  assert.match(js, /id="fixtureDayFilter"/);
  assert.match(js, /data-filter="venue"/);
  assert.match(js, /id="venueFilter"/);
  assert.match(js, /data-filter="race"/);
  assert.match(js, /id="raceFilter"/);
  assert.match(js, /fixtureDay/);
  assert.doesNotMatch(js, /id="raceSearch"/);
});

test("race finder exposes the one-day Irishracing odds action and attribution", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(js, /\/api\/qvm\/racing\/irishracing-odds/);
  assert.match(js, /data-load-irish-odds/);
  assert.match(js, /Irishracing\.com/);
});

test("page refresh automatically loads Irishracing odds with one top-level control", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="refreshOddsBtn"/);
  assert.match(html, /data-odds-refresh-status/);
  assert.match(js, /async function refreshIrishRacingOdds\(/);
  assert.match(js, /\/api\/qvm\/racing\/irishracing-odds\/batch/);
  const loadData = js.match(/async function loadData\([^)]*\) \{[\s\S]*?\n\}/)[0];
  assert.match(loadData, /refreshIrishRacingOdds\(/);
  assert.match(js, /#refreshOddsBtn/);
});

test("mobile header stacks controls without squeezing or breaking the title", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.topbar\{[^}]*flex-direction:column/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.top-actions\{[^}]*width:100%/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.topbar h1\{[^}]*overflow-wrap:normal/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.top-actions[^}]*grid-template-columns/);
});

test("weather evidence control has a stable hook and visible result state", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const healthCard = js.match(/function healthCard\(\) \{[\s\S]*?\n\}\n\nfunction dashboard/)[0];
  assert.match(healthCard, /data-weather="true"/);
  assert.match(js, /function weatherEvidenceCard\(\)/);
  assert.match(healthCard, /weatherEvidenceCard\(\)/);
  assert.match(js, /data-weather-result/);
});

test("OpenAI assistant exposes an actionable request lifecycle", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const agents = js.match(/function agents\(\) \{[\s\S]*?\n\}\n\nfunction settings/)[0];
  assert.match(agents, /data-ask-ai="true"/);
  assert.match(js, /aria-busy/);
  assert.match(js, /Asking OpenAI/);
  assert.match(js, /OpenAI unavailable:/);
});

test("AI assistant is placed first with a readable scrollable response panel", async () => {
  const js = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const agents = js.match(/function agents\(\) \{[\s\S]*?\n\}\n\nfunction settings/)[0];
  assert.ok(agents.indexOf('data-ai-panel="true"') < agents.indexOf('OpenAI assistant'));
  assert.match(agents, /id="aiAnswer"/);
  assert.match(css, /\.ai-panel\{[^}]*min-height:/);
  assert.match(css, /\.ai-answer\{[^}]*max-height:[^}]*overflow-y:auto/);
});
