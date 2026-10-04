const IRISHRACING_ORIGIN = "https://www.irishracing.com";
const MONTHS = new Map([
  ["jan", 0], ["feb", 1], ["mar", 2], ["apr", 3], ["may", 4], ["jun", 5],
  ["jul", 6], ["aug", 7], ["sep", 8], ["oct", 9], ["nov", 10], ["dec", 11],
]);

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function visibleText(value = "") {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseName(value = "") {
  return visibleText(value)
    .replace(/\s*\((?:IRE|GB|FR|USA|AUS|GER|NZ|CAN)\)\s*$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normaliseVenue(value = "") {
  return visibleText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function fractionalToDecimal(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 1 ? Number(value.toFixed(4)) : null;
  const text = visibleText(value).toUpperCase().replace(/\s+/g, "");
  if (!text) return null;
  if (["EVS", "EVENS", "E"].includes(text)) return 2;
  const match = text.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((1 + numerator / denominator).toFixed(4));
}

function parseDateSlug(value = "") {
  const match = String(value).match(/(?:^|\/)[A-Za-z]+-(\d{1,2})(?:st|nd|rd|th)-([A-Za-z]{3})-(\d{4})(?:\/|$)/i);
  if (!match) return null;
  const month = MONTHS.get(match[2].toLowerCase());
  if (month === undefined) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function parseClock(value = "") {
  const match = String(value).match(/(?:^|\/)(\d{3,4})(?:\/|$)/);
  if (!match) return null;
  const raw = match[1].padStart(4, "0");
  const hours = Number(raw.slice(0, 2));
  const minutes = Number(raw.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function clockFromText(value = "") {
  const match = visibleText(value).match(/\b(\d{1,2})[.:](\d{2})\b/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function dublinLocalToUtc(date, minutes) {
  const candidate = new Date(`${date}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`);
  if (Number.isNaN(candidate.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(candidate).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  const displayedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offsetMs = displayedAsUtc - candidate.getTime();
  return new Date(candidate.getTime() - offsetMs).toISOString();
}

function targetClocks(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return [];
  const clocks = new Set([date.getUTCHours() * 60 + date.getUTCMinutes()]);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  clocks.add(Number(parts.hour) * 60 + Number(parts.minute));
  return [...clocks].filter((clock) => Number.isFinite(clock));
}

export function findIrishRacingCardLink(indexHtml, { venue, scheduledOffAt }) {
  const targetVenue = normaliseVenue(venue);
  const targetTimes = targetClocks(scheduledOffAt);
  const links = [...String(indexHtml || "").matchAll(/<a\b[^>]*href=["']([^"']*\/racecards\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const href = new URL(decodeHtmlEntities(match[1]), IRISHRACING_ORIGIN).toString();
      const pathParts = new URL(href).pathname.split("/").filter(Boolean);
      return { href, text: visibleText(match[2]), pathParts, venue: normaliseVenue(pathParts.at(-2) || ""), clock: parseClock(pathParts.at(-1)) || clockFromText(match[2]) };
    })
    .filter((item) => item.venue && (!targetVenue || item.venue === targetVenue || item.venue.includes(targetVenue) || targetVenue.includes(item.venue)));
  if (!links.length) return null;
  const exact = links.find((item) => targetTimes.includes(item.clock));
  if (exact) return exact.href;
  const closest = links
    .filter((item) => Number.isFinite(item.clock) && targetTimes.length)
    .map((item) => ({ ...item, distance: Math.min(...targetTimes.map((target) => Math.abs(item.clock - target))) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return closest && closest.distance <= 45 ? closest.href : null;
}

function priceForRunner(html, number) {
  const marker = new RegExp(`id=["']price${String(number).replace(/[^\w-]/g, "")}["']`, "i").exec(html);
  if (!marker) return { fractional: null, odds: null };
  const openingTagStart = html.lastIndexOf("<", marker.index);
  const markerEnd = html.indexOf(">", marker.index);
  const tagName = html.slice(openingTagStart, markerEnd + 1).match(/^<([a-z0-9]+)/i)?.[1] || "span";
  const closingTag = html.indexOf(`</${tagName}>`, markerEnd);
  const snippet = markerEnd >= 0 && closingTag > markerEnd ? html.slice(markerEnd + 1, closingTag) : "";
  const match = snippet.match(/class=["']bkprice["'][^>]*>\s*([^<]+)\s*</i);
  const fractional = match ? visibleText(match[1]) : visibleText(snippet).match(/^(\d+(?:\.\d+)?\s*\/\s*\d+|EVS|EVENS)$/i)?.[1] || null;
  return { fractional, odds: fractionalToDecimal(fractional) };
}

function xmlAttributes(value = "") {
  return Object.fromEntries([...String(value).matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1], decodeHtmlEntities(match[2])]));
}

function isUsableOddsPrice(price) {
  const attributes = xmlAttributes(price);
  if (String(attributes.bt || "").toUpperCase() === "E") return false;
  if (String(attributes.id || "") === "1") return false;
  const decimal = Number(attributes.pricedec);
  const odds = Number.isFinite(decimal) && decimal > 1 ? decimal : fractionalToDecimal(attributes.price);
  return Number.isFinite(odds) && odds > 1;
}

export function parseIrishRacingOddsXml(xml) {
  return [...String(xml || "").matchAll(/<runner\b([^>]*)>([\s\S]*?)<\/runner>/gi)].map((runnerMatch) => {
    const runnerAttributes = xmlAttributes(runnerMatch[1]);
    const prices = [...runnerMatch[2].matchAll(/<price\b([^>]*)\/?>(?:<\/price>)?/gi)]
      .map((match) => match[1])
      .filter(isUsableOddsPrice)
      .map((value) => {
        const attributes = xmlAttributes(value);
        const fractional = visibleText(attributes.price);
        const odds = Number(attributes.pricedec) > 1 ? Number(attributes.pricedec) : fractionalToDecimal(fractional);
        return { odds, oddsFractional: fractionalToDecimal(fractional) ? fractional : null, oddsUpdatedAt: attributes.date_stamp || null };
      })
      .filter((price) => Number.isFinite(price.odds) && price.odds > 1)
      .sort((a, b) => b.odds - a.odds);
    const best = prices[0] || { odds: null, oddsFractional: null, oddsUpdatedAt: null };
    return {
      sourceRunnerId: `irishracing:${runnerAttributes.id || runnerAttributes.saddleno || "unknown"}`,
      number: runnerAttributes.saddleno || null,
      odds: best.odds,
      oddsFractional: best.oddsFractional,
      oddsUpdatedAt: best.oddsUpdatedAt,
    };
  }).filter((runner) => runner.number);
}

export function extractIrishRacingOddsRequest(html) {
  const courseCode = String(html || "").match(/\bselprc\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  const raceKey = String(html || "").match(/\bselprd\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  return courseCode && raceKey ? { courseCode, raceKey } : null;
}

export function mergeIrishRacingOdds(parsed, xml) {
  const pricesByNumber = new Map(parseIrishRacingOddsXml(xml).map((runner) => [String(runner.number), runner]));
  return {
    ...parsed,
    runners: (parsed?.runners || []).map((runner) => {
      const price = pricesByNumber.get(String(runner.number));
      return price ? { ...runner, odds: price.odds, oddsFractional: price.oddsFractional, oddsUpdatedAt: price.oddsUpdatedAt } : runner;
    }),
  };
}

function sourceIdentity(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const date = parseDateSlug(parts[1]);
  const clock = parseClock(parts.at(-1));
  return {
    venue: visibleText(parts.at(-2) || "Unknown venue").replace(/-/g, " "),
    scheduledOffAt: date && Number.isFinite(clock) ? dublinLocalToUtc(date, clock) : null,
  };
}

export function parseIrishRacingRacecard(html, sourceUrl) {
  const source = sourceIdentity(sourceUrl);
  const title = visibleText(String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const titleVenue = title.match(/^Racecard\s+([^,|]+)/i)?.[1];
  const anchors = [...String(html || "").matchAll(/<a\b[^>]*id=["']hxfrm(\d+)["'][^>]*class=["'][^"']*\brunner\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const runners = anchors.map((match, index) => {
    const rowStart = String(html).lastIndexOf('<div class="row runner-line', match.index);
    const prefix = String(html).slice(Math.max(0, rowStart), match.index);
    const number = prefix.match(/class=["'][^"']*\bsn\b[^"']*["'][\s\S]{0,240}?<strong>\s*([^<]+?)\s*<\/strong>/i)?.[1]?.trim() || String(index + 1);
    const price = priceForRunner(String(html), match[1]);
    const rowSnippet = String(html).slice(Math.max(0, rowStart), match.index + 1800);
    const status = /\b(?:NR|non[- ]runner|withdrawn)\b/i.test(rowSnippet) ? "WITHDRAWN" : "DECLARED";
    const horseName = visibleText(match[2]);
    return {
      sourceRunnerId: `irishracing:${number}:${normaliseName(horseName)}`,
      number,
      horseName,
      odds: price.odds,
      oddsFractional: price.fractional,
      oddsBookmaker: "Irishracing.com best available",
      status,
    };
  });
  return {
    provider: "irishracing.com",
    sourceUrl,
    venue: titleVenue || source.venue,
    scheduledOffAt: source.scheduledOffAt,
    raceName: title.match(/,\s*\d{1,2}[.:]\d{2},\s*(.+?)\s*\|/i)?.[1] || null,
    runners,
  };
}

function runnerMatch(sourceRunner, inputRunner) {
  const sourceName = normaliseName(sourceRunner.horseName);
  const inputName = normaliseName(inputRunner.horseName || inputRunner.horse || inputRunner.name);
  return (inputName && sourceName === inputName) || (String(sourceRunner.number) === String(inputRunner.number) && Boolean(inputRunner.number));
}

export function buildIrishRacingQuote(parsed, inputRunners = [], capturedAt = new Date().toISOString()) {
  const incoming = Array.isArray(inputRunners) ? inputRunners : [];
  const sourceRunners = Array.isArray(parsed?.runners) ? parsed.runners : [];
  const runners = incoming.length
    ? incoming.map((inputRunner) => {
      const sourceRunner = sourceRunners.find((item) => runnerMatch(item, inputRunner));
      return {
        runnerId: inputRunner.providerRunnerId || inputRunner.runnerId || sourceRunner?.sourceRunnerId || null,
        number: inputRunner.number || sourceRunner?.number || null,
        horseName: inputRunner.horseName || inputRunner.horse || inputRunner.name || sourceRunner?.horseName || "Unnamed runner",
        odds: sourceRunner?.odds ?? null,
        modelProbability: Number.isFinite(Number(inputRunner.modelProbability)) ? Number(inputRunner.modelProbability) : null,
        oddsFractional: sourceRunner?.oddsFractional || null,
        oddsBookmaker: sourceRunner?.oddsBookmaker || "Irishracing.com best available",
        status: inputRunner.status || sourceRunner?.status || "DECLARED",
      };
    })
    : sourceRunners.map((runner) => ({ runnerId: runner.sourceRunnerId, modelProbability: null, ...runner }));
  const active = runners.filter((runner) => !["WITHDRAWN", "NON_RUNNER", "NR"].includes(String(runner.status || "").toUpperCase()));
  const completeBook = active.length >= 2 && active.every((runner) => Number(runner.odds) > 1);
  return {
    provider: "irishracing.com",
    sourceUrl: parsed?.sourceUrl || null,
    capturedAt,
    sourceUpdatedAt: capturedAt,
    completeBook,
    venue: parsed?.venue || null,
    scheduledOffAt: parsed?.scheduledOffAt || null,
    raceName: parsed?.raceName || null,
    runners,
  };
}

export { IRISHRACING_ORIGIN };
