import { closingLineValue, edgeDecision } from "./racing/edge.js";
import { brierScore, calibrationBins, drawdown, logLoss } from "./racing/metrics.js";
import { calculateStake, dataQualityScore, driftReport, equitySeries, featureProvenance, marketBlend, oddsMovement, segmentCalibration, segmentKey, validateQuoteSnapshot } from "./racing/analytics.js";
import { buildIrishRacingQuote, extractIrishRacingOddsRequest, findIrishRacingCardLink, IRISHRACING_ORIGIN, mergeIrishRacingOdds, parseIrishRacingRacecard } from "./racing/irishracing.js";
import { buildDecisionContract, quoteAgeSeconds, quoteSnapshotId, stableEvidenceId } from "./racing/decision-contract.js";
import { favouriteBaseline, marketBaseline, priceSensitivity, sampleStatus } from "./racing/research.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const memory = { positions: [], snapshots: [], quotes: [], notes: [], filters: [], alerts: [], health: [], imports: [], races: [], results: [], watchlist: [], lifecycle: [], settings: { bankroll: 1000, maxStakePct: .1, maxTotalExposurePct: .3, maxFixtureExposurePct: .1, modelWeight: .5 } };
const irishRacingPageCache = new Map();
const IRISHRACING_INDEX_TTL_MS = 60_000;
const IRISHRACING_CARD_TTL_MS = 30_000;
const IRISHRACING_BATCH_TTL_MS = 15_000;
const irishRacingBatchCache = new Map();
const aiRequestTimes = new Map();
const schemaReady = new WeakSet();
const schemaPromises = new WeakMap();
const DEFAULT_VISITOR_ID = "anonymous";

function visitorIdFromRequest(request) {
  const header = request.headers.get("x-qvm-visitor-id") || "";
  const cookie = request.headers.get("cookie")?.match(/(?:^|;)\s*qvm_visitor_id=([^;]+)/)?.[1] || "";
  const value = String(header || cookie || DEFAULT_VISITOR_ID).trim().slice(0, 120);
  return /^[a-zA-Z0-9._:-]+$/.test(value) ? value : DEFAULT_VISITOR_ID;
}

export function clearIrishRacingPageCache() {
  irishRacingPageCache.clear();
  irishRacingBatchCache.clear();
}
const candidate = { runnerId: "demo:horse:1", runner: "Alpha Meridian", venue: "Kempton 14:20", odds: 3.55, probability: .34, edge: .172, quoteAgeSeconds: 24, dataQuality: 95, action: "PAPER_CANDIDATE" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const now = () => new Date().toISOString();
export const database = (env) => env?.QVM_RACING_DB || env?.["qvm-racing"] || env?.QVM_RACING;
const WEATHER_HOURLY = "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code";

function queryParams(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else params.set(key, value);
  }
  return params;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchJson(url, init = {}) {
  const response = await fetchWithTimeout(url, { ...init, headers: { accept: "application/json", "user-agent": "QVM-Racing-Workbench/1.0", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.reason || body.detail || body.error || `Upstream request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function fetchHtml(url) {
  const parsed = new URL(url);
  if (parsed.origin !== IRISHRACING_ORIGIN) throw new Error("IRISHRACING_SOURCE_NOT_ALLOWED");
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-IE,en;q=0.8",
      "user-agent": "QVM-Racing-Workbench/1.0 (paper research; source attribution in app)"
    }
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Irishracing request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function fetchIrishRacingOddsXml({ courseCode, raceKey }) {
  const params = new URLSearchParams({ prf: "updatebets", prc: courseCode, prd: raceKey, prt: "N", prmfb: "0" });
  const response = await fetchWithTimeout(`${IRISHRACING_ORIGIN}/odds-comparison?${params}`, {
    headers: {
      accept: "application/xml,text/xml,*/*;q=0.01",
      "accept-language": "en-IE,en;q=0.8",
      "user-agent": "QVM-Racing-Workbench/1.0 (paper research; source attribution in app)",
      "x-requested-with": "XMLHttpRequest",
    }
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Irishracing odds request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function cachedIrishRacingPage(url, ttlMs) {
  const cached = irishRacingPageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.html;
  const html = await fetchHtml(url);
  irishRacingPageCache.set(url, { html, expiresAt: Date.now() + ttlMs });
  return html;
}

function nearestHourlyObservation(hourly, raceTime) {
  if (!hourly?.time?.length) return null;
  const target = Date.parse(raceTime || new Date().toISOString());
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  hourly.time.forEach((value, index) => {
    const distance = Math.abs(Date.parse(`${value}Z`) - target);
    if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
  });
  const observation = { time: hourly.time[bestIndex] };
  for (const key of Object.keys(hourly)) if (key !== "time") observation[key] = hourly[key]?.[bestIndex] ?? null;
  return observation;
}

function nearestMetNoObservation(timeseries, raceTime) {
  if (!Array.isArray(timeseries) || !timeseries.length) return null;
  const target = Date.parse(raceTime || new Date().toISOString());
  const item = timeseries.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestDistance = Math.abs(Date.parse(best.time) - target);
    const candidateDistance = Math.abs(Date.parse(candidate.time) - target);
    return candidateDistance < bestDistance ? candidate : best;
  }, null);
  const instant = item?.data?.instant?.details || {};
  const next = item?.data?.next_1_hours?.details || item?.data?.next_6_hours?.details || item?.data?.next_12_hours?.details || {};
  const windSpeed = Number(instant.wind_speed);
  return {
    time: item?.time || null,
    temperature_2m: instant.air_temperature ?? null,
    relative_humidity_2m: instant.relative_humidity ?? null,
    precipitation: next.precipitation_amount ?? null,
    wind_speed_10m: Number.isFinite(windSpeed) ? Number((windSpeed * 3.6).toFixed(2)) : null,
    wind_direction_10m: instant.wind_from_direction ?? null,
    weather_code: next.symbol_code || null
  };
}

async function metNoWeather(latitude, longitude, raceTime) {
  const params = queryParams({ lat: latitude, lon: longitude });
  const payload = await fetchJson(`https://api.met.no/weatherapi/locationforecast/2.0/compact?${params}`, { headers: { "user-agent": "QVM-Racing-Workbench/1.0" } });
  const observation = nearestMetNoObservation(payload.properties?.timeseries, raceTime);
  if (!observation) throw new Error("MET_NO_FORECAST_EMPTY");
  return json({ provider: "met.no", mode: "forecast", fallback: "met-no", latitude, longitude, raceTime, observation, source: payload });
}

async function openMeteoWeather(url) {
  const parsed = new URL(url);
  const latitude = Number(parsed.searchParams.get("latitude"));
  const longitude = Number(parsed.searchParams.get("longitude"));
  const raceTime = parsed.searchParams.get("raceTime") || new Date().toISOString();
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json({ error: "INVALID_WEATHER_COORDINATES" }, 400);
  const raceDate = new Date(raceTime);
  if (Number.isNaN(raceDate.getTime())) return json({ error: "INVALID_RACE_TIME" }, 400);
  const isHistorical = raceDate.getTime() < Date.now() - 24 * 60 * 60 * 1000;
  const endpoint = isHistorical ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const date = raceTime.slice(0, 10);
  const params = queryParams({ latitude, longitude, hourly: WEATHER_HOURLY, timezone: "UTC", ...(isHistorical ? { start_date: date, end_date: date } : { forecast_days: 2 }) });
  try {
    const payload = await fetchJson(`${endpoint}?${params}`);
    const observation = nearestHourlyObservation(payload.hourly, raceTime);
    if (!observation) throw new Error("OPEN_METEO_HOURLY_EMPTY");
    return json({ provider: "open-meteo", mode: isHistorical ? "historical" : "forecast", latitude, longitude, raceTime, observation, source: payload });
  } catch (error) {
    try {
      const currentParams = queryParams({ latitude, longitude, current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code", timezone: "UTC" });
      const current = await fetchJson(`https://api.open-meteo.com/v1/forecast?${currentParams}`);
      return json({ provider: "open-meteo", mode: "current", fallback: "current", notice: isHistorical ? "Open-Meteo archive unavailable; this is a current observation and is not historical race evidence." : "Hourly forecast unavailable; this is a current observation.", latitude, longitude, raceTime, observation: { time: current.current?.time, ...current.current }, source: current });
    } catch {
      return metNoWeather(latitude, longitude, raceTime);
    }
  }
}

function racingApiAuth(env) {
  if (!env?.RACING_API_USERNAME || !env?.RACING_API_PASSWORD) return null;
  return `Basic ${btoa(`${env.RACING_API_USERNAME}:${env.RACING_API_PASSWORD}`)}`;
}

function fixtureDayForScheduledOff(scheduledOffAt, requestedDay) {
  const parsed = new Date(scheduledOffAt || "");
  if (Number.isNaN(parsed.getTime())) return requestedDay;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduledDate = parsed.toISOString().slice(0, 10);
  return scheduledDate === today ? "today" : scheduledDate === tomorrow ? "tomorrow" : requestedDay;
}

async function racingApiRequest(env, path, values) {
  const authorization = racingApiAuth(env);
  if (!authorization) return json({ error: "RACING_API_NOT_CONFIGURED", message: "Add RACING_API_USERNAME and RACING_API_PASSWORD to enable live fixtures and historical results." }, 503);
  const base = env.RACING_API_BASE_URL || "https://api.theracingapi.com";
  try {
    const payload = await fetchJson(`${base}${path}?${queryParams(values)}`, { headers: { authorization } });
    return payload;
  } catch (error) {
    return json({ error: "RACING_API_UNAVAILABLE", message: error.message }, error.status === 401 ? 502 : 503);
  }
}

function providerOdds(runner = {}) {
  const raw = [runner.odds, runner.back_odds, runner.price].flatMap((value) => Array.isArray(value) ? value : [value]);
  const prices = raw.map((value) => {
    if (value && typeof value === "object") return { odds: Number(value.decimal ?? value.price ?? value.odds), bookmaker: value.bookmaker || value.source || null, updatedAt: value.updated || value.updated_at || value.changed_at || null };
    return { odds: Number(value), bookmaker: null, updatedAt: null };
  }).filter((value) => Number.isFinite(value.odds) && value.odds > 1);
  return prices.sort((a, b) => b.odds - a.odds)[0] || { odds: null, bookmaker: null, updatedAt: null };
}

function normalizeRacingCard(card, fixtureDay = null) {
  const providerRaceId = String(card.race_id || stableEvidenceId("race", ["the-racing-api", card.course, card.region, card.off_dt || card.date, card.off_time]));
  const rawRunners = Array.isArray(card.runners) ? card.runners : [];
  const scheduledOffAt = card.off_dt || `${card.date}T${card.off_time || "00:00"}:00`;
  return {
    provider: "the-racing-api", providerRaceId, venue: card.course, country: card.region,
    scheduledOffAt, distance: card.distance_round, distanceMeters: Number(card.distance_meters || card.distance) || null,
    fixtureDay: fixtureDayForScheduledOff(scheduledOffAt, fixtureDay), raceName: card.race_name || card.raceName || card.name || card.title || null,
    discipline: card.discipline || "FLAT", className: card.class || card.class_name || null, going: card.going, surface: card.surface, fieldSize: Number(card.field_size) || (card.runners || []).length,
    status: card.is_abandoned ? "ABANDONED" : String(card.race_status || "SCHEDULED").toUpperCase(),
    sourceWeather: card.weather || null,
    runners: rawRunners.map((runner, index) => {
      const price = providerOdds(runner);
      const providerRunnerId = String(runner.horse_id || stableEvidenceId("runner", ["the-racing-api", providerRaceId, runner.number || index + 1, runner.horse]));
      const rating = Number(runner.performance_rating ?? runner.speed_rating ?? runner.rating);
      return { providerRunnerId, horseName: runner.horse, number: runner.number, form: runner.form, status: runner.number === "NR" ? "WITHDRAWN" : String(runner.status || "DECLARED").toUpperCase(), trainer: runner.trainer, jockey: runner.jockey, speedRating: runner.speed_rating, performanceRating: runner.performance_rating, modelProbability: Number.isFinite(rating) && rating > 0 ? null : null, odds: price.odds, oddsBookmaker: price.bookmaker, oddsUpdatedAt: price.updatedAt };
    })
  };
}

async function ensureSchema(env) {
  const db = database(env);
  if (!db) return false;
  if (schemaReady.has(env)) return true;
  const pending = schemaPromises.get(env);
  if (pending) return pending;
  const initialization = (async () => {
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS racing_paper_positions (id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, runner TEXT NOT NULL, venue TEXT NOT NULL, odds REAL NOT NULL, probability REAL NOT NULL, stake REAL NOT NULL, status TEXT NOT NULL, outcome TEXT, pnl REAL, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_decision_snapshots (id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, runner TEXT NOT NULL, venue TEXT NOT NULL, odds REAL NOT NULL, model_probability REAL NOT NULL, market_probability REAL, data_quality REAL, quote_age_seconds REAL, model_version TEXT NOT NULL, decision_json TEXT NOT NULL, close_odds REAL, outcome TEXT, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_quote_snapshots (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, provider TEXT NOT NULL, captured_at TEXT NOT NULL, source_updated_at TEXT, complete_book INTEGER NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL, venue TEXT, scheduled_off_at TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_research_notes (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, runner_id TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_saved_filters (id TEXT PRIMARY KEY, name TEXT NOT NULL, filter_json TEXT NOT NULL, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_alerts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_provider_health (id TEXT PRIMARY KEY, provider TEXT NOT NULL, status TEXT NOT NULL, latency_ms REAL, message TEXT, checked_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_import_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, accepted INTEGER NOT NULL, rejected INTEGER NOT NULL, errors_json TEXT NOT NULL, created_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_results (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, result_json TEXT NOT NULL, captured_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_watchlist (race_id TEXT PRIMARY KEY, label TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_visitor_watchlist (visitor_id TEXT NOT NULL, race_id TEXT NOT NULL, label TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (visitor_id, race_id))"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_race_lifecycle (race_id TEXT PRIMARY KEY, status TEXT NOT NULL, reason TEXT, updated_at TEXT NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS racing_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    ]);
    try { await db.prepare("ALTER TABLE racing_paper_positions ADD COLUMN snapshot_id TEXT").run(); } catch { /* column already exists */ }
    try { await db.prepare("ALTER TABLE racing_paper_positions ADD COLUMN visitor_id TEXT NOT NULL DEFAULT 'anonymous'").run(); } catch { /* column already exists */ }
    await db.batch([
      db.prepare("CREATE INDEX IF NOT EXISTS idx_racing_paper_positions_visitor_created ON racing_paper_positions(visitor_id, created_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_racing_quotes_race_captured ON racing_quote_snapshots(race_id, captured_at)"),
    ]);
    for (const statement of [
      "ALTER TABLE racing_quote_snapshots ADD COLUMN venue TEXT",
      "ALTER TABLE racing_quote_snapshots ADD COLUMN scheduled_off_at TEXT",
      "ALTER TABLE racing_paper_positions ADD COLUMN race_id TEXT",
      "ALTER TABLE racing_paper_positions ADD COLUMN segment TEXT",
      "ALTER TABLE racing_paper_positions ADD COLUMN close_odds REAL",
      "ALTER TABLE racing_paper_positions ADD COLUMN commission REAL DEFAULT 0.2",
      "ALTER TABLE racing_paper_positions ADD COLUMN data_quality REAL",
      "ALTER TABLE racing_paper_positions ADD COLUMN slippage REAL",
    ]) { try { await db.prepare(statement).run(); } catch { /* column already exists */ } }
    for (const statement of [
      "ALTER TABLE racing_decision_snapshots ADD COLUMN data_cutoff_at TEXT",
      "ALTER TABLE racing_decision_snapshots ADD COLUMN provenance_json TEXT",
    ]) { try { await db.prepare(statement).run(); } catch { /* column already exists */ } }
    schemaReady.add(env);
    return true;
  })().catch((error) => {
    schemaPromises.delete(env);
    throw error;
  });
  schemaPromises.set(env, initialization);
  return initialization;
}

function createServerSnapshot(runnerId) {
  if (runnerId !== candidate.runnerId) return null;
  const dataCutoffAt = now();
  const decision = edgeDecision({ modelProbability: candidate.probability, odds: candidate.odds, marketProbability: 1 / candidate.odds, quoteAgeSeconds: candidate.quoteAgeSeconds, dataQuality: candidate.dataQuality, uncertainty: .08 });
  return { id: ["snapshot-", crypto.randomUUID()].join(""), runnerId: candidate.runnerId, runner: candidate.runner, venue: candidate.venue, odds: candidate.odds, modelProbability: candidate.probability, marketProbability: decision.noVigProbability, dataQuality: candidate.dataQuality, quoteAgeSeconds: candidate.quoteAgeSeconds, modelVersion: "racing-logit-v2", decision, dataCutoffAt, provenance: featureProvenance({ race: { venue: candidate.venue, provider: "demo" }, modelVersion: "racing-logit-v2", cutoffAt: dataCutoffAt }), closeOdds: null, outcome: null, createdAt: dataCutoffAt };
}

function blockedLiveDecision(settings, dataMode = "NO_COMPLETE_RUNNER_BOOK") {
  const contract = buildDecisionContract({ settings, now: now() });
  return {
    ...contract,
    modelVersion: "racing-logit-v2",
    dataMode,
    runner: { ...contract.runner, runnerId: null, runner: "No complete runner book", venue: "Awaiting timestamped odds", action: "ABSTAIN" },
    decision: { ...contract.decision, reasons: [...new Set([...contract.decision.reasons, dataMode])] },
    provenance: featureProvenance({ modelVersion: "racing-logit-v2" }),
    settings,
    capturedAt: now(),
  };
}

function decisionFromQuote(quote, settings, runnerId = null, race = null, referenceNow = now()) {
  const contract = buildDecisionContract({
    race: race || { raceId: quote?.raceId, venue: quote?.venue, scheduledOffAt: quote?.scheduledOffAt, status: "SCHEDULED" },
    quote,
    runnerId,
    settings,
    now: referenceNow,
  });
  const selected = (quote?.runners || []).find((runner) => String(runner.runnerId) === String(contract.runner.runnerId));
  const dataCutoffAt = referenceNow;
  return {
    ...contract,
    modelVersion: "racing-logit-v2",
    dataMode: quote ? "LIVE_QUOTE_SNAPSHOT" : "NO_COMPLETE_RUNNER_BOOK",
    runner: { ...contract.runner, runner: contract.runner.horseName, venue: race?.venue || quote?.venue || "No fixture", edge: contract.decision.expectedValue, action: contract.decision.status },
    quote: quote ? { ...quote, asOf: quote.capturedAt, runners: quote.runners || [] } : null,
    provenance: featureProvenance({ race: { ...(race || {}), venue: race?.venue || quote?.venue, provider: quote?.provider }, quote, modelVersion: "racing-logit-v2", cutoffAt: dataCutoffAt }),
    settings,
    capturedAt: dataCutoffAt,
    selectedRunner: selected || null,
  };
}

async function liveDecision(env, raceId = null, runnerId = null) {
  const settings = await getSettings(env);
  const quotes = await listQuoteSnapshots(env, raceId);
  const quote = raceId ? quotes.find((snapshot) => String(snapshot.raceId) === String(raceId)) : quotes.find((snapshot) => (snapshot.runners || []).some((runner) => String(runner.runnerId) === String(candidate.runnerId))) || quotes[0];
  const lifecycle = raceId ? (await listLifecycle(env, raceId))[0] : null;
  const response = decisionFromQuote(quote, settings, runnerId, quote ? { raceId, venue: quote.venue, scheduledOffAt: quote.scheduledOffAt, status: lifecycle?.status || "SCHEDULED" } : null);
  await saveDecisionSnapshot(env, response);
  return response;
}

function snapshotFromDecision(response) {
  const runnerId = response.runner?.runnerId || null;
  const id = response.decisionId || stableEvidenceId("snapshot", [response.quote?.id, runnerId, response.modelVersion]);
  return { id, runnerId, runner: response.runner.runner || response.runner.horseName, venue: response.runner.venue || response.race?.venue, odds: response.runner.odds, modelProbability: response.runner.modelProbability ?? response.runner.probability, marketProbability: response.decision.noVigProbability, dataQuality: response.runner.dataQuality, quoteAgeSeconds: response.quoteAgeSeconds ?? response.runner.quoteAgeSeconds, modelVersion: response.modelVersion, decision: response.decision, dataCutoffAt: response.capturedAt, provenance: response.provenance, closeOdds: null, outcome: null, createdAt: response.capturedAt };
}

async function saveDecisionSnapshot(env, response) {
  if (!response?.runner?.runnerId || !response.decision?.gates?.modelScore) return null;
  const snapshot = snapshotFromDecision(response);
  if (await ensureSchema(env)) {
    await database(env).prepare("INSERT OR IGNORE INTO racing_decision_snapshots (id,runner_id,runner,venue,odds,model_probability,market_probability,data_quality,quote_age_seconds,model_version,decision_json,close_odds,outcome,created_at,data_cutoff_at,provenance_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(snapshot.id, snapshot.runnerId, snapshot.runner, snapshot.venue, snapshot.odds, snapshot.modelProbability, snapshot.marketProbability, snapshot.dataQuality, snapshot.quoteAgeSeconds, snapshot.modelVersion, JSON.stringify(snapshot.decision), null, null, snapshot.createdAt, snapshot.dataCutoffAt || snapshot.createdAt, JSON.stringify(snapshot.provenance || {})).run();
  } else if (!memory.snapshots.some((item) => item.id === snapshot.id)) memory.snapshots.push(snapshot);
  return snapshot;
}

function snapshotFromRow(row) {
  return { id: row.id, runnerId: row.runner_id, runner: row.runner, venue: row.venue, odds: row.odds, modelProbability: row.model_probability, marketProbability: row.market_probability, dataQuality: row.data_quality, quoteAgeSeconds: row.quote_age_seconds, modelVersion: row.model_version, decision: JSON.parse(row.decision_json || "{}"), dataCutoffAt: row.data_cutoff_at || row.created_at, provenance: JSON.parse(row.provenance_json || "{}"), closeOdds: row.close_odds, outcome: row.outcome, createdAt: row.created_at };
}

function quoteFromRow(row) {
  return { id: row.id, raceId: row.race_id, provider: row.provider, capturedAt: row.captured_at, sourceUpdatedAt: row.source_updated_at, completeBook: Boolean(row.complete_book), venue: row.venue || null, scheduledOffAt: row.scheduled_off_at || null, runners: JSON.parse(row.content_json || "[]"), createdAt: row.created_at };
}

function parseArray(value) { return Array.isArray(value) ? value : []; }

async function saveQuoteSnapshot(env, snapshot) {
  const validation = validateQuoteSnapshot(snapshot);
  if (!validation.valid) return { ok: false, errors: validation.errors, validation };
  const id = snapshot.id || quoteSnapshotId(snapshot);
  const record = { ...snapshot, id, provider: snapshot.provider || "import", completeBook: snapshot.completeBook !== false, createdAt: snapshot.createdAt || now() };
  if (await ensureSchema(env)) {
    await database(env).prepare("INSERT OR IGNORE INTO racing_quote_snapshots (id,race_id,provider,captured_at,source_updated_at,complete_book,content_json,created_at,venue,scheduled_off_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(record.id, record.raceId, record.provider, record.capturedAt, record.sourceUpdatedAt || null, record.completeBook ? 1 : 0, JSON.stringify(record.runners), record.createdAt, record.venue || null, record.scheduledOffAt || null).run();
  } else {
    const index = memory.quotes.findIndex((item) => item.id === record.id);
    if (index >= 0) memory.quotes[index] = record; else memory.quotes.unshift(record);
  }
  return { ok: true, snapshot: record, validation };
}

async function listQuoteSnapshots(env, raceId = null) {
  if (await ensureSchema(env)) {
    const result = raceId
      ? await database(env).prepare("SELECT * FROM racing_quote_snapshots WHERE race_id=? ORDER BY captured_at DESC LIMIT 200").bind(raceId).all()
      : await database(env).prepare("SELECT * FROM racing_quote_snapshots ORDER BY captured_at DESC LIMIT 200").all();
    return (result.results || []).map(quoteFromRow);
  }
  return memory.quotes.filter((item) => !raceId || item.raceId === raceId).sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0, 200);
}

async function saveProviderHealth(env, health) {
  const checkedAt = now();
  const record = { id: stableEvidenceId("health", [health.provider, health.status, health.message, checkedAt.slice(0, 16)]), checkedAt, ...health };
  if (await ensureSchema(env)) await database(env).prepare("INSERT OR REPLACE INTO racing_provider_health (id,provider,status,latency_ms,message,checked_at) VALUES (?,?,?,?,?,?)").bind(record.id, record.provider, record.status, record.latencyMs || null, record.message || null, record.checkedAt).run();
  else {
    const index = memory.health.findIndex((item) => item.id === record.id);
    if (index >= 0) memory.health[index] = record; else memory.health.unshift(record);
  }
  return record;
}

async function loadIrishRacingOdds(env, body = {}) {
  const raceId = String(body.raceId || "").trim();
  const venue = String(body.venue || "").trim();
  const scheduledOffAt = String(body.scheduledOffAt || body.scheduled_off_at || "").trim();
  const runners = Array.isArray(body.runners) ? body.runners.slice(0, 200) : [];
  if (!raceId || !venue || !scheduledOffAt || Number.isNaN(Date.parse(scheduledOffAt)) || runners.length < 2) {
    return json({ error: "IRISHRACING_INPUT_REQUIRED", message: "Race, venue, scheduled off time, and at least two runners are required." }, 400);
  }

  const startedAt = Date.now();
  try {
    const indexHtml = await cachedIrishRacingPage(`${IRISHRACING_ORIGIN}/racecards`, IRISHRACING_INDEX_TTL_MS);
    const sourceUrl = findIrishRacingCardLink(indexHtml, { venue, scheduledOffAt });
    if (!sourceUrl) {
      await saveProviderHealth(env, { provider: "irishracing.com", status: "DEGRADED", latencyMs: Date.now() - startedAt, message: "No one-day racecard matched the selected venue and scheduled off time." });
      return json({ error: "IRISHRACING_RACE_NOT_FOUND", message: "No Irishracing.com racecard matched this venue and scheduled off time." }, 404);
    }
    const cardHtml = await cachedIrishRacingPage(sourceUrl, IRISHRACING_CARD_TTL_MS);
    let parsed = parseIrishRacingRacecard(cardHtml, sourceUrl);
    const activeParsedRunners = parsed.runners.filter((runner) => runner.status === "DECLARED");
    if (activeParsedRunners.length >= 2 && activeParsedRunners.some((runner) => !(Number(runner.odds) > 1))) {
      const oddsRequest = extractIrishRacingOddsRequest(cardHtml);
      if (oddsRequest) {
        const oddsXml = await fetchIrishRacingOddsXml(oddsRequest);
        parsed = mergeIrishRacingOdds(parsed, oddsXml);
      }
    }
    const quote = buildIrishRacingQuote(parsed, runners, now());
    quote.raceId = raceId;
    quote.venue = quote.venue || venue;
    quote.scheduledOffAt = quote.scheduledOffAt || scheduledOffAt;
    if (!quote.completeBook) {
      await saveProviderHealth(env, { provider: "irishracing.com", status: "DEGRADED", latencyMs: Date.now() - startedAt, message: "Racecard loaded, but one or more active runners had no valid price; paper betting remains blocked." });
      return json({
        error: "IRISHRACING_QUOTE_INCOMPLETE",
        message: "Irishracing.com did not return a complete active-runner book. Paper betting remains blocked.",
        quote,
        source: { name: "Irishracing.com", url: sourceUrl, attribution: "Odds source: Irishracing.com" }
      }, 422);
    }
    const saved = await saveQuoteSnapshot(env, quote);
    if (!saved.ok) {
      await saveProviderHealth(env, { provider: "irishracing.com", status: "DEGRADED", latencyMs: Date.now() - startedAt, message: "The scraped quote failed the QVM evidence validation gates." });
      return json({ error: "IRISHRACING_QUOTE_INVALID", errors: saved.errors, quote }, 422);
    }
    await saveProviderHealth(env, { provider: "irishracing.com", status: "HEALTHY", latencyMs: Date.now() - startedAt, message: "One-day comparison quote loaded and timestamped." });
    return json({
      quote: saved.snapshot,
      source: { name: "Irishracing.com", url: sourceUrl, attribution: "Odds source: Irishracing.com" },
      notice: "Comparison odds only. QVM paper decisions still require a fresh complete book and all deterministic gates."
    });
  } catch (error) {
    await saveProviderHealth(env, { provider: "irishracing.com", status: "DEGRADED", latencyMs: Date.now() - startedAt, message: error.message || "Irishracing.com unavailable." });
    return json({ error: "IRISHRACING_UNAVAILABLE", message: error.message || "Irishracing.com is temporarily unavailable." }, 503);
  }
}

async function loadIrishRacingOddsBatch(env, body = {}, visitorId = DEFAULT_VISITOR_ID) {
  const input = Array.isArray(body.races) ? body.races.slice(0, 100) : [];
  const races = input.map((race) => ({
    raceId: String(race?.raceId || race?.providerRaceId || race?.provider_race_id || "").trim(),
    venue: String(race?.venue || "").trim(),
    scheduledOffAt: String(race?.scheduledOffAt || race?.scheduled_off_at || "").trim(),
    runners: Array.isArray(race?.runners) ? race.runners.slice(0, 200).map((runner) => ({
      providerRunnerId: runner?.providerRunnerId || runner?.provider_runner_id || runner?.runnerId || runner?.runner_id || null,
      number: runner?.number || null,
      horseName: runner?.horseName || runner?.horse || runner?.name || "Unnamed runner",
      modelProbability: Number.isFinite(Number(runner?.modelProbability)) ? Number(runner.modelProbability) : null,
      status: runner?.status || "DECLARED"
    })) : []
  })).filter((race) => race.raceId && race.venue && Number.isFinite(Date.parse(race.scheduledOffAt)) && race.runners.length >= 2);
  if (!races.length) return json({ error: "IRISHRACING_BATCH_INPUT_REQUIRED", message: "At least one current race with venue, scheduled off time, and two runners is required." }, 400);
  const batchKey = stableEvidenceId("irish-batch", races);
  const cachedBatch = irishRacingBatchCache.get(batchKey);
  if (cachedBatch && cachedBatch.expiresAt > Date.now()) return json({ ...cachedBatch.body, cached: true });
  if (visitorId !== DEFAULT_VISITOR_ID) {
    const lastRequestAt = aiRequestTimes.get("odds:" + visitorId) || 0;
    if (Date.now() - lastRequestAt < 5_000) return json({ error: "ODDS_RATE_LIMITED", message: "Odds refresh is already running; try again in a few seconds." }, 429);
    aiRequestTimes.set("odds:" + visitorId, Date.now());
  }

  const startedAt = Date.now();
  let indexHtml;
  try {
    indexHtml = await cachedIrishRacingPage(`${IRISHRACING_ORIGIN}/racecards`, IRISHRACING_INDEX_TTL_MS);
  } catch (error) {
    await saveProviderHealth(env, { provider: "irishracing.com", status: "DEGRADED", latencyMs: Date.now() - startedAt, message: error.message || "Irishracing.com unavailable." });
    return json({ error: "IRISHRACING_UNAVAILABLE", message: error.message || "Irishracing.com is temporarily unavailable.", requested: races.length, loaded: 0, items: [], failures: races.map((race) => ({ raceId: race.raceId, error: "INDEX_UNAVAILABLE", message: error.message || "Irishracing.com unavailable." })) }, 503);
  }

  const settings = await getSettings(env);
  const results = new Array(races.length);
  let cursor = 0;
  const workerCount = Math.min(5, races.length);
  const processRaces = async () => {
    while (true) {
      const currentIndex = cursor++;
      const race = races[currentIndex];
      if (!race) return;
      try {
        const sourceUrl = findIrishRacingCardLink(indexHtml, race);
        if (!sourceUrl) {
          results[currentIndex] = { raceId: race.raceId, error: "IRISHRACING_RACE_NOT_FOUND", message: "No Irishracing.com racecard matched this venue and scheduled off time." };
          continue;
        }
        const cardHtml = await cachedIrishRacingPage(sourceUrl, IRISHRACING_CARD_TTL_MS);
        let parsed = parseIrishRacingRacecard(cardHtml, sourceUrl);
        const activeParsedRunners = parsed.runners.filter((runner) => runner.status === "DECLARED");
        if (activeParsedRunners.length >= 2 && activeParsedRunners.some((runner) => !(Number(runner.odds) > 1))) {
          const oddsRequest = extractIrishRacingOddsRequest(cardHtml);
          if (oddsRequest) {
            const oddsXml = await fetchIrishRacingOddsXml(oddsRequest);
            parsed = mergeIrishRacingOdds(parsed, oddsXml);
          }
        }
        const quote = buildIrishRacingQuote(parsed, race.runners, now());
        quote.raceId = race.raceId;
        quote.venue = quote.venue || race.venue;
        quote.scheduledOffAt = quote.scheduledOffAt || race.scheduledOffAt;
        if (!quote.completeBook) {
          results[currentIndex] = { raceId: race.raceId, error: "IRISHRACING_QUOTE_INCOMPLETE", message: "Irishracing.com did not return a complete active-runner book; paper betting remains blocked." };
          continue;
        }
        const saved = await saveQuoteSnapshot(env, quote);
        if (!saved.ok) {
          results[currentIndex] = { raceId: race.raceId, error: "IRISHRACING_QUOTE_INVALID", message: saved.errors?.join(", ") || "The quote failed evidence validation." };
          continue;
        }
        results[currentIndex] = {
          raceId: race.raceId,
          quote: saved.snapshot,
          paperDecision: decisionFromQuote(saved.snapshot, settings),
          source: { name: "Irishracing.com", url: sourceUrl, attribution: "Odds source: Irishracing.com" }
        };
      } catch (error) {
        results[currentIndex] = { raceId: race.raceId, error: "IRISHRACING_UNAVAILABLE", message: error.message || "Irishracing.com is temporarily unavailable." };
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => processRaces()));

  const items = results.filter((result) => result?.quote);
  const failures = results.filter((result) => result && !result.quote);
  const notice = failures.length ? `${items.length} race odds loaded; ${failures.length} race${failures.length === 1 ? "" : "s"} unavailable or incomplete.` : "Irishracing.com odds loaded and timestamped for all requested races.";
  await saveProviderHealth(env, {
    provider: "irishracing.com",
    status: items.length && !failures.length ? "HEALTHY" : "DEGRADED",
    latencyMs: Date.now() - startedAt,
    message: notice
  });
  const responseBody = { provider: "irishracing.com", requested: races.length, loaded: items.length, items, failures, notice, capturedAt: now() };
  irishRacingBatchCache.set(batchKey, { body: responseBody, expiresAt: Date.now() + IRISHRACING_BATCH_TTL_MS });
  return json(responseBody);
}

async function providerHealth(env) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_provider_health ORDER BY checked_at DESC LIMIT 20").all();
    return (result.results || []).map((row) => ({ id: row.id, provider: row.provider, status: row.status, latencyMs: row.latency_ms, message: row.message, checkedAt: row.checked_at }));
  }
  return memory.health.slice(0, 20);
}

async function positionsForAnalytics(env, visitorId = DEFAULT_VISITOR_ID) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_paper_positions WHERE visitor_id=? ORDER BY created_at ASC").bind(visitorId).all();
    return (result.results || []).map((row) => ({ ...row, id: row.id, runnerId: row.runner_id, raceId: row.race_id, segment: row.segment, odds: Number(row.odds), probability: Number(row.probability), stake: Number(row.stake), status: row.status, outcome: row.outcome, pnl: row.pnl == null ? null : Number(row.pnl), closeOdds: row.close_odds == null ? null : Number(row.close_odds), slippage: row.slippage == null ? null : Number(row.slippage), dataQuality: row.data_quality == null ? null : Number(row.data_quality), createdAt: row.created_at }));
  }
  return memory.positions.filter((position) => (position.visitorId || DEFAULT_VISITOR_ID) === visitorId);
}

async function saveAlert(env, alert) {
  const record = { id: `alert-${crypto.randomUUID()}`, status: "OPEN", createdAt: now(), ...alert };
  if (await ensureSchema(env)) await database(env).prepare("INSERT INTO racing_alerts (id,kind,title,message,status,created_at) VALUES (?,?,?,?,?,?)").bind(record.id, record.kind, record.title, record.message, record.status, record.createdAt).run();
  else memory.alerts.unshift(record);
  return record;
}

async function getSettings(env) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT key,value_json FROM racing_settings").all();
    const settings = { ...memory.settings };
    for (const row of result.results || []) settings[row.key] = JSON.parse(row.value_json || "null");
    return settings;
  }
  return { ...memory.settings };
}

async function saveSettings(env, updates) {
  const allowed = ["bankroll", "maxStakePct", "maxTotalExposurePct", "maxFixtureExposurePct", "modelWeight", "minDataQuality", "maxQuoteAgeSeconds"];
  const clean = {};
  for (const key of allowed) if (updates[key] !== undefined && Number.isFinite(Number(updates[key]))) clean[key] = Number(updates[key]);
  Object.assign(memory.settings, clean);
  if (await ensureSchema(env)) {
    for (const [key, value] of Object.entries(clean)) await database(env).prepare("INSERT OR REPLACE INTO racing_settings (key,value_json,updated_at) VALUES (?,?,?)").bind(key, JSON.stringify(value), now()).run();
  }
  return getSettings(env);
}

async function listAlerts(env) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_alerts WHERE status='OPEN' ORDER BY created_at DESC LIMIT 50").all();
    return (result.results || []).map((row) => ({ id: row.id, kind: row.kind, title: row.title, message: row.message, status: row.status, createdAt: row.created_at }));
  }
  return memory.alerts.filter((alert) => alert.status === "OPEN").slice(0, 50);
}

async function listNotes(env, raceId = null) {
  if (await ensureSchema(env)) {
    const result = raceId
      ? await database(env).prepare("SELECT * FROM racing_research_notes WHERE race_id=? ORDER BY created_at DESC LIMIT 100").bind(raceId).all()
      : await database(env).prepare("SELECT * FROM racing_research_notes ORDER BY created_at DESC LIMIT 100").all();
    return (result.results || []).map((row) => ({ id: row.id, raceId: row.race_id, runnerId: row.runner_id, note: row.note, createdAt: row.created_at }));
  }
  return memory.notes.filter((note) => !raceId || note.raceId === raceId).slice(0, 100);
}

async function saveNote(env, body) {
  const note = { id: `note-${crypto.randomUUID()}`, raceId: String(body.raceId || "unknown"), runnerId: body.runnerId || null, note: String(body.note || "").trim(), createdAt: now() };
  if (!note.note) return null;
  if (await ensureSchema(env)) await database(env).prepare("INSERT INTO racing_research_notes (id,race_id,runner_id,note,created_at) VALUES (?,?,?,?,?)").bind(note.id, note.raceId, note.runnerId, note.note, note.createdAt).run();
  else memory.notes.unshift(note);
  return note;
}

async function listFilters(env) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_saved_filters ORDER BY created_at DESC LIMIT 50").all();
    return (result.results || []).map((row) => ({ id: row.id, name: row.name, filter: JSON.parse(row.filter_json || "{}"), createdAt: row.created_at }));
  }
  return memory.filters;
}

async function saveFilter(env, body) {
  const filter = { id: `filter-${crypto.randomUUID()}`, name: String(body.name || "Untitled filter").trim().slice(0, 80), filter: body.filter || {}, createdAt: now() };
  if (await ensureSchema(env)) await database(env).prepare("INSERT INTO racing_saved_filters (id,name,filter_json,created_at) VALUES (?,?,?,?)").bind(filter.id, filter.name, JSON.stringify(filter.filter), filter.createdAt).run();
  else memory.filters.unshift(filter);
  return filter;
}

async function listResults(env) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_results ORDER BY captured_at DESC LIMIT 200").all();
    return (result.results || []).map((row) => ({ id: row.id, raceId: row.race_id, result: JSON.parse(row.result_json || "{}"), capturedAt: row.captured_at }));
  }
  return memory.results;
}

async function listWatchlist(env, visitorId = DEFAULT_VISITOR_ID) {
  if (await ensureSchema(env)) {
    const result = await database(env).prepare("SELECT * FROM racing_visitor_watchlist WHERE visitor_id=? AND active=1 ORDER BY updated_at DESC LIMIT 200").bind(visitorId).all();
    return (result.results || []).map((row) => ({ raceId: row.race_id, label: row.label, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at }));
  }
  return memory.watchlist.filter((item) => item.active && (item.visitorId || DEFAULT_VISITOR_ID) === visitorId).slice(0, 200);
}

async function saveWatchlist(env, body, visitorId = DEFAULT_VISITOR_ID) {
  const raceId = String(body.raceId || "").trim();
  if (!raceId) return null;
  const active = body.active !== false;
  const record = { raceId, visitorId, label: String(body.label || "").trim().slice(0, 120) || null, active, createdAt: now(), updatedAt: now() };
  if (await ensureSchema(env)) {
    const existing = await database(env).prepare("SELECT created_at FROM racing_visitor_watchlist WHERE visitor_id=? AND race_id=?").bind(visitorId, raceId).first();
    record.createdAt = existing?.created_at || record.createdAt;
    await database(env).prepare("INSERT OR REPLACE INTO racing_visitor_watchlist (visitor_id,race_id,label,active,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(visitorId, record.raceId, record.label, active ? 1 : 0, record.createdAt, record.updatedAt).run();
  } else {
    const index = memory.watchlist.findIndex((item) => item.raceId === raceId && (item.visitorId || DEFAULT_VISITOR_ID) === visitorId);
    if (index >= 0) memory.watchlist[index] = record; else memory.watchlist.unshift(record);
  }
  return record;
}

async function listLifecycle(env, raceId = null) {
  if (await ensureSchema(env)) {
    const result = raceId
      ? await database(env).prepare("SELECT * FROM racing_race_lifecycle WHERE race_id=?").bind(raceId).all()
      : await database(env).prepare("SELECT * FROM racing_race_lifecycle ORDER BY updated_at DESC LIMIT 200").all();
    return (result.results || []).map((row) => ({ raceId: row.race_id, status: row.status, reason: row.reason, updatedAt: row.updated_at }));
  }
  return memory.lifecycle.filter((item) => !raceId || item.raceId === raceId).slice(0, 200);
}

async function saveLifecycle(env, body) {
  const raceId = String(body.raceId || "").trim();
  const status = String(body.status || "").toUpperCase();
  const allowed = ["SCHEDULED", "DELAYED", "RUNNING", "FINISHED", "ABANDONED", "SETTLED", "VOID"];
  if (!raceId || !allowed.includes(status)) return null;
  const record = { raceId, status, reason: String(body.reason || "").trim().slice(0, 240) || null, updatedAt: now() };
  if (await ensureSchema(env)) {
    await database(env).prepare("INSERT OR REPLACE INTO racing_race_lifecycle (race_id,status,reason,updated_at) VALUES (?,?,?,?)").bind(record.raceId, record.status, record.reason, record.updatedAt).run();
  } else {
    const index = memory.lifecycle.findIndex((item) => item.raceId === raceId);
    if (index >= 0) memory.lifecycle[index] = record; else memory.lifecycle.unshift(record);
  }
  if (["ABANDONED", "VOID"].includes(status)) await saveAlert(env, { kind: "RACE_STATUS", title: "Race status changed", message: raceId + " is now " + status + (record.reason ? ": " + record.reason : ".") });
  return record;
}

async function importRecords(env, body) {
  const kind = String(body.kind || "").toLowerCase();
  const records = parseArray(body.records);
  const errors = []; let accepted = 0;
  if (!records.length) return { accepted: 0, rejected: 0, errors: ["RECORDS_REQUIRED"] };
  for (const record of records) {
    if (kind === "quotes") {
      const saved = await saveQuoteSnapshot(env, record);
      if (saved.ok) accepted += 1; else errors.push(...saved.errors.map((error) => `${record.raceId || "quote"}:${error}`));
    } else if (kind === "results") {
      try {
        const capturedAt = record.capturedAt || now();
        timestampForImport(capturedAt);
        const result = { id: record.id || stableEvidenceId("result", [String(record.raceId || "unknown"), capturedAt, record.winner || record.winning_horse || record.first || record.result]), raceId: String(record.raceId || "unknown"), result: record, capturedAt };
        let isNew = true;
        if (await ensureSchema(env)) {
          const existing = await database(env).prepare("SELECT id FROM racing_results WHERE id=?").bind(result.id).first();
          isNew = !existing;
          await database(env).prepare("INSERT OR IGNORE INTO racing_results (id,race_id,result_json,captured_at) VALUES (?,?,?,?)").bind(result.id, result.raceId, JSON.stringify(result.result), result.capturedAt).run();
        } else if (memory.results.some((item) => item.id === result.id)) isNew = false;
        if (isNew) { if (!database(env)) memory.results.unshift(result); accepted += 1; }
      } catch (error) { errors.push(error.message); }
    } else if (kind === "races") {
      if (!record.raceId && !record.providerRaceId) errors.push("RACE_ID_REQUIRED");
      else {
        const raceId = String(record.raceId || record.providerRaceId);
        const id = stableEvidenceId("race-import", [raceId, record.scheduledOffAt || record.scheduled_off_at]);
        if (!memory.races.some((item) => item._stableId === id)) { memory.races.unshift({ ...record, _stableId: id }); accepted += 1; }
      }
    } else errors.push("UNSUPPORTED_IMPORT_KIND");
  }
  const job = { id: `import-${crypto.randomUUID()}`, kind, accepted, rejected: records.length - accepted, errors: [...new Set(errors)], createdAt: now() };
  if (await ensureSchema(env)) await database(env).prepare("INSERT INTO racing_import_jobs (id,kind,accepted,rejected,errors_json,created_at) VALUES (?,?,?,?,?,?)").bind(job.id, job.kind, job.accepted, job.rejected, JSON.stringify(job.errors), job.createdAt).run(); else memory.imports.unshift(job);
  return job;
}

function timestampForImport(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed > new Date()) throw new Error("INVALID_IMPORT_TIMESTAMP");
  return parsed;
}

function activeFixtureRunners(fixture) {
  return (fixture?.runners || []).filter((runner) => !["WITHDRAWN", "NON_RUNNER", "NR"].includes(String(runner.status || "").toUpperCase()));
}

function mergeQuoteIntoFixture(fixture, quote) {
  const quoteById = new Map((quote?.runners || []).map((runner) => [String(runner.runnerId), runner]));
  const quoteByNumber = new Map((quote?.runners || []).filter((runner) => runner.number != null).map((runner) => [String(runner.number), runner]));
  return {
    ...fixture,
    runners: (fixture.runners || []).map((runner) => {
      const quoted = quoteById.get(String(runner.providerRunnerId)) || quoteByNumber.get(String(runner.number));
      return quoted ? { ...runner, odds: quoted.odds, oddsBookmaker: quoted.oddsBookmaker, oddsUpdatedAt: quoted.oddsUpdatedAt, modelProbability: quoted.modelProbability ?? runner.modelProbability } : runner;
    })
  };
}

function aiFixtureSummary(fixture) {
  return {
    raceId: fixture.providerRaceId,
    fixtureDay: fixture.fixtureDay,
    venue: fixture.venue,
    country: fixture.country,
    raceName: fixture.raceName,
    scheduledOffAt: fixture.scheduledOffAt,
    status: fixture.status,
    going: fixture.going,
    surface: fixture.surface,
    fieldSize: fixture.fieldSize,
    source: fixture.provider,
    quoteCapturedAt: fixture.quoteCapturedAt || null,
    quoteAgeSeconds: fixture.quoteCapturedAt ? quoteAgeSeconds(fixture.quoteCapturedAt, now()) : null,
    decisionContract: fixture.decisionContract || fixture.paperDecision || null,
    runners: activeFixtureRunners(fixture).slice(0, 40).map((runner) => ({
      runnerId: runner.providerRunnerId,
      horseName: runner.horseName,
      number: runner.number,
      status: runner.status,
      odds: runner.odds,
      modelProbability: runner.modelProbability ?? null,
      bookmaker: runner.oddsBookmaker,
      oddsUpdatedAt: runner.oddsUpdatedAt
    }))
  };
}

function aiQuoteSummary(quote) {
  return {
    quoteId: quote.id,
    raceId: quote.raceId,
    provider: quote.provider,
    venue: quote.venue,
    scheduledOffAt: quote.scheduledOffAt,
    capturedAt: quote.capturedAt,
    sourceUpdatedAt: quote.sourceUpdatedAt,
    completeBook: quote.completeBook,
    asOf: quote.capturedAt,
    runners: (quote.runners || []).slice(0, 40).map((runner) => ({
      runnerId: runner.runnerId,
      horseName: runner.horseName,
      status: runner.status,
      odds: runner.odds,
      modelProbability: runner.modelProbability ?? null,
      bookmaker: runner.oddsBookmaker,
      oddsUpdatedAt: runner.oddsUpdatedAt
    }))
  };
}

async function currentAiEvidence(env, visitorId = DEFAULT_VISITOR_ID) {
  const liveResults = racingApiAuth(env)
    ? await Promise.all(["today", "tomorrow"].map((day) => racingFixtureDay(env, day, ["gb", "ire"])))
    : [];
  const settings = await getSettings(env);
  const liveFixtures = [];
  const seen = new Set();
  for (const result of liveResults) {
    if (result.payload instanceof Response) continue;
    for (const card of Array.isArray(result.payload.racecards) ? result.payload.racecards : []) {
      const fixture = normalizeRacingCard(card, result.day);
      const key = String(fixture.providerRaceId || `${fixture.fixtureDay}:${fixture.venue}:${fixture.scheduledOffAt}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const runners = activeFixtureRunners(fixture);
      if (result.oddsAvailable && runners.length >= 2 && runners.every((runner) => Number(runner.odds) > 1)) {
        const existingQuotes = await listQuoteSnapshots(env, fixture.providerRaceId);
        const reusableQuotes = existingQuotes.filter((quote) => quoteAgeSeconds(quote.capturedAt, now()) <= Number(settings.maxQuoteAgeSeconds || 300));
        const existingQuote = reusableQuotes.find((quote) => quote.provider === "irishracing.com") || reusableQuotes[0] || null;
        const capturedAt = now();
        const saved = existingQuote ? { ok: true, snapshot: existingQuote } : await saveQuoteSnapshot(env, {
            raceId: fixture.providerRaceId,
            venue: fixture.venue,
            scheduledOffAt: fixture.scheduledOffAt,
            provider: fixture.provider,
            capturedAt,
            sourceUpdatedAt: runners.map((runner) => runner.oddsUpdatedAt).find(Boolean) || capturedAt,
            runners: fixture.runners.map((runner) => ({ runnerId: runner.providerRunnerId, odds: runner.odds, horseName: runner.horseName, status: runner.status, modelProbability: runner.modelProbability, oddsBookmaker: runner.oddsBookmaker, oddsUpdatedAt: runner.oddsUpdatedAt }))
          });
        if (saved.ok) {
          fixture.quoteCapturedAt = saved.snapshot.capturedAt;
          fixture.quoteAgeSeconds = quoteAgeSeconds(saved.snapshot.capturedAt, now());
          fixture.paperDecision = decisionFromQuote(saved.snapshot, settings, null, fixture);
          fixture.decisionContract = fixture.paperDecision;
          await saveDecisionSnapshot(env, fixture.paperDecision);
        }
      }
      if (!fixture.paperDecision) fixture.paperDecision = blockedLiveDecision(settings, result.oddsAvailable ? "NO_COMPLETE_RUNNER_BOOK" : "ODDS_UNAVAILABLE");
      fixture.decisionContract = fixture.paperDecision;
      liveFixtures.push(fixture);
    }
  }
  const quotes = await listQuoteSnapshots(env);
  const positions = await positionsForAnalytics(env, visitorId);
  const health = await providerHealth(env);
  const lifecycle = await listLifecycle(env);
  return {
    capturedAt: now(),
    liveFixtureFeed: {
      requestedDays: ["today", "tomorrow"],
      fixtures: liveFixtures.slice(0, 100).map(aiFixtureSummary),
      failures: liveResults.filter((result) => result.payload instanceof Response).map((result) => ({ day: result.day, status: result.payload.status, message: result.message })),
      source: "the-racing-api"
    },
    database: {
      quoteSnapshots: quotes.slice(0, 100).map(aiQuoteSummary),
      paperPositions: positions.slice(-100).map((position) => ({ raceId: position.raceId, runnerId: position.runnerId, runner: position.runner, venue: position.venue, odds: position.odds, probability: position.probability, stake: position.stake, status: position.status, dataQuality: position.dataQuality, createdAt: position.createdAt })),
      providerHealth: health.slice(0, 20),
      lifecycle: lifecycle.slice(0, 100),
      settings: { bankroll: settings.bankroll, maxStakePct: settings.maxStakePct, maxTotalExposurePct: settings.maxTotalExposurePct, maxFixtureExposurePct: settings.maxFixtureExposurePct, minDataQuality: settings.minDataQuality, maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds }
    }
  };
}

async function openAiAnswer(request, env, visitorId = DEFAULT_VISITOR_ID) {
  if (!env?.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED", message: "Add OPENAI_API_KEY to enable the hosted OpenAI assistant." }, 503);
  const body = await request.json().catch(() => null);
  const message = String(body?.message || "").trim();
  if (!message) return json({ error: "MESSAGE_REQUIRED" }, 400);
  if (visitorId !== DEFAULT_VISITOR_ID) {
    const lastRequestAt = aiRequestTimes.get("ai:" + visitorId) || 0;
    if (Date.now() - lastRequestAt < 2_000) return json({ error: "AI_RATE_LIMITED", message: "The assistant is cooling down; try again in a couple of seconds." }, 429);
    aiRequestTimes.set("ai:" + visitorId, Date.now());
  }
  const model = env.OPENAI_MODEL || "gpt-5-mini";
  const reasoningEffort = ["minimal", "low", "medium", "high"].includes(env.OPENAI_REASONING_EFFORT) ? env.OPENAI_REASONING_EFFORT : "medium";
  let evidence;
  try {
    evidence = await currentAiEvidence(env, visitorId);
  } catch (error) {
    evidence = { capturedAt: now(), error: "LIVE_EVIDENCE_UNAVAILABLE: " + error.message, liveFixtureFeed: { requestedDays: ["today", "tomorrow"], fixtures: [], failures: [], source: "the-racing-api" }, database: { quoteSnapshots: [], paperPositions: [], providerHealth: [], lifecycle: [], settings: {} } };
  }
  const contextSummary = {
    capturedAt: evidence.capturedAt,
    liveFixtureCount: evidence.liveFixtureFeed.fixtures.length,
    storedQuoteCount: evidence.database.quoteSnapshots.length,
    openPaperPositionCount: evidence.database.paperPositions.filter((position) => position.status === "OPEN").length,
    providerHealthCount: evidence.database.providerHealth.length,
    evidenceError: evidence.error || null
  };
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      input: [
        { role: "system", content: "You are the QVM Racing Workbench assistant. Use only the server evidence packet supplied with the user's question. Distinguish live fixture feed data from stored database quote snapshots, cite the captured timestamp and source in your explanation, and say when odds are missing, stale, incomplete, or unavailable. You may analyse paper decisions and risk gates, but never place or imply a live bet and never invent prices, runners, fixtures, or probabilities." },
        { role: "user", content: `Question:\n${message}\n\nServer evidence packet (JSON):\n${JSON.stringify(evidence)}` }
      ],
      max_output_tokens: 1200
    })
  }, 30000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: "OPENAI_UNAVAILABLE", message: payload.error?.message || `OpenAI request failed (${response.status})` }, 503);
  const answer = extractOpenAiText(payload) || deterministicEvidenceSummary(evidence);
  return json({ provider: "openai", model, reasoningEffort, answer, context: { ...contextSummary, answerSource: extractOpenAiText(payload) ? "openai" : "server-evidence-fallback" } });
}

export function extractOpenAiText(payload = {}) {
  const direct = typeof payload.output_text === "string" ? payload.output_text.trim() : "";
  if (direct) return direct;
  const texts = [];
  const collect = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (typeof value !== "object") return;
    if (typeof value.text === "string" && value.text.trim()) texts.push(value.text.trim());
    if (value.content) collect(value.content);
  };
  collect(payload.output);
  return [...new Set(texts)].join("\n");
}

function deterministicEvidenceSummary(evidence = {}) {
  const fixtures = evidence.liveFixtureFeed?.fixtures || [];
  const decisions = fixtures.map((fixture) => fixture.paperDecision || fixture.decisionContract).filter(Boolean);
  const candidates = decisions.filter((decision) => decision.decision?.status === "PAPER_CANDIDATE");
  const reasons = [...new Set(decisions.flatMap((decision) => decision.decision?.reasons || []))].slice(0, 5);
  const sources = [...new Set(fixtures.map((fixture) => {
    const quote = fixture.paperDecision?.quote || fixture.decisionContract?.quote;
    return quote?.provider && quote?.capturedAt ? `${quote.provider} as of ${quote.capturedAt}` : null;
  }).filter(Boolean))].slice(0, 4);
  const lines = [
    `Server evidence captured at ${evidence.capturedAt || "an unavailable time"}.`,
    `${fixtures.length} live fixture${fixtures.length === 1 ? "" : "s"} were supplied to the assistant.`,
    candidates.length ? `${candidates.length} fixture decision${candidates.length === 1 ? "" : "s"} passed the deterministic paper gates.` : "No fixture decision passed every deterministic paper gate.",
    reasons.length ? `Observed gate reasons include ${reasons.join(", ")}.` : "No gate reason was returned.",
    sources.length ? `Recorded quote sources: ${sources.join("; ")}.` : "No stored quote source and as-of timestamp was available."
  ];
  return lines.join(" ");
}

async function overview(env, visitorId = DEFAULT_VISITOR_ID) {
  if (await ensureSchema(env)) {
    const row = await database(env).prepare("SELECT COUNT(*) AS count FROM racing_paper_positions WHERE status='OPEN' AND visitor_id=?").bind(visitorId).first();
    return { provider: "hosted", modelVersion: "racing-logit-v2", paperOnly: true, openPositions: row?.count || 0, heartbeat: { status: "READY" } };
  }
  return { provider: "hosted", modelVersion: "racing-logit-v2", paperOnly: true, openPositions: memory.positions.filter((p) => p.status === "OPEN" && (p.visitorId || DEFAULT_VISITOR_ID) === visitorId).length, heartbeat: { status: "READY" } };
}

function performanceMetrics(positions = []) {
  const settled = positions.filter((position) => position.status === "SETTLED");
  const pnls = settled.map((position) => Number(position.pnl) || 0);
  const records = settled.map((position) => ({ probability: Number(position.probability), outcome: position.outcome === "WON" ? 1 : 0, segment: position.segment || "UNKNOWN" }));
  const brierScores = records.map((record) => brierScore([1 - record.probability, record.probability], record.outcome ? 1 : 0));
  const losses = records.map((record) => logLoss(record.outcome ? record.probability : 1 - record.probability));
  const clvValues = settled.filter((position) => Number(position.closeOdds) > 1).map((position) => closingLineValue(position.odds, position.closeOdds)).filter((value) => value != null);
  const slippageValues = settled.map((position) => Number(position.slippage)).filter(Number.isFinite);
  const quality = settled.map((position) => Number(position.dataQuality)).filter(Number.isFinite);
  const drift = driftReport(records.slice(0, Math.floor(records.length / 2)), records.slice(Math.floor(records.length / 2)));
  drift.status = settled.length >= 60 ? (drift.drifted ? "DRIFTED" : "STABLE") : "INSUFFICIENT_DATA";
  return {
    settledPositions: settled.length,
    netPaperPnl: roundNumber(pnls.reduce((sum, pnl) => sum + pnl, 0)),
    turnover: roundNumber(positions.reduce((sum, position) => sum + (Number(position.stake) || 0), 0)),
    drawdown: drawdown(pnls),
    brierScore: brierScores.length ? roundNumber(brierScores.reduce((sum, score) => sum + score, 0) / brierScores.length) : null,
    logLoss: losses.length ? roundNumber(losses.reduce((sum, loss) => sum + loss, 0) / losses.length) : null,
    calibrationBins: calibrationBins(records, 5),
    segmentCalibration: segmentCalibration(records),
    equitySeries: equitySeries(settled),
    closingLineValue: clvValues.length ? roundNumber(clvValues.reduce((sum, value) => sum + value, 0) / clvValues.length) : null,
    averageSlippage: slippageValues.length ? roundNumber(slippageValues.reduce((sum, value) => sum + value, 0) / slippageValues.length) : null,
    averageDataQuality: quality.length ? roundNumber(quality.reduce((sum, value) => sum + value, 0) / quality.length) : null,
    drift,
    sampleStatus: sampleStatus(settled.length),
    modelCalibration: { sampleCount: settled.length, sampleStatus: sampleStatus(settled.length), minimumSample: 30 },
    marketBaseline: marketBaseline(settled),
    favouriteBaseline: favouriteBaseline(settled),
    priceSensitivity: positions.slice(-10).map((position) => ({ runnerId: position.runnerId, raceId: position.raceId, createdAt: position.createdAt, ...priceSensitivity({ probability: position.probability, odds: position.odds }) })),
    minimumSample: 30
  };
}

function roundNumber(value) { return Number(Number(value).toFixed(4)); }

const FIXTURE_DAYS = new Set(["today", "tomorrow"]);

function requestedFixtureDays(url) {
  const raw = url.searchParams.get("days") || url.searchParams.get("day") || "today";
  const days = [...new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter((value) => FIXTURE_DAYS.has(value)))];
  return days.length ? days : ["today"];
}

async function racingFixtureDay(env, day, regions) {
  const requestedPath = env.RACING_API_RACECARDS_PATH || "/v1/racecards/standard";
  let oddsAvailable = requestedPath !== "/v1/racecards/free";
  let oddsNotice = null;
  let payload = await racingApiRequest(env, requestedPath, { day, region_codes: regions, limit: 500 });
  if (payload instanceof Response && requestedPath === "/v1/racecards/standard" && [401, 403, 404, 502, 503].includes(payload.status)) {
    const freePayload = await racingApiRequest(env, "/v1/racecards/free", { day, region_codes: regions, limit: 500 });
    if (!(freePayload instanceof Response)) {
      payload = freePayload;
      oddsAvailable = false;
      oddsNotice = "The Racing API Standard plan is required for current runner odds; fixtures are shown without executable prices.";
    }
  }
  const message = payload instanceof Response
    ? (await payload.clone().json().catch(() => ({}))).message || ("HTTP " + payload.status)
    : null;
  return { day, payload, oddsAvailable, oddsNotice, message };
}

async function api(request, env) {
  const url = new URL(request.url);
  const visitorId = visitorIdFromRequest(request);
  if (url.pathname === "/api/qvm/racing/integrations" && request.method === "GET") {
    return json({ openMeteo: { provider: "open-meteo", configured: true, authentication: "none" }, racingApi: { provider: "the-racing-api", configured: Boolean(racingApiAuth(env)), authentication: "basic", credentials: ["RACING_API_USERNAME", "RACING_API_PASSWORD"] }, openai: { provider: "openai", configured: Boolean(env?.OPENAI_API_KEY), authentication: "server-side" }, paperOnly: true, localWorkerRequired: false });
  }
  if (url.pathname === "/api/qvm/racing/health" && request.method === "GET") {
    return json({ providers: await providerHealth(env), policy: { staleAfterSeconds: 300, paperOnly: true }, checkedAt: now() });
  }
  if (url.pathname === "/api/qvm/racing/settings" && request.method === "GET") return json({ settings: await getSettings(env) });
  if (url.pathname === "/api/qvm/racing/settings" && request.method === "POST") return json({ settings: await saveSettings(env, await request.json().catch(() => ({}))) });
  if (url.pathname === "/api/qvm/racing/quotes" && request.method === "GET") return json({ snapshots: await listQuoteSnapshots(env, url.searchParams.get("raceId")) });
  if (url.pathname === "/api/qvm/racing/quotes" && request.method === "POST") {
    const saved = await saveQuoteSnapshot(env, await request.json().catch(() => ({})));
    return saved.ok ? json(saved, 201) : json({ error: "INVALID_QUOTE_SNAPSHOT", errors: saved.errors, validation: saved.validation }, 400);
  }
  if (url.pathname === "/api/qvm/racing/import" && request.method === "POST") return json(await importRecords(env, await request.json().catch(() => ({}))), 201);
  if (url.pathname === "/api/qvm/racing/results" && request.method === "GET") return json({ results: await listResults(env) });
  if (url.pathname === "/api/qvm/racing/notes" && request.method === "GET") return json({ notes: await listNotes(env, url.searchParams.get("raceId")) });
  if (url.pathname === "/api/qvm/racing/notes" && request.method === "POST") {
    const note = await saveNote(env, await request.json().catch(() => ({})));
    return note ? json(note, 201) : json({ error: "NOTE_REQUIRED" }, 400);
  }
  if (url.pathname === "/api/qvm/racing/filters" && request.method === "GET") return json({ filters: await listFilters(env) });
  if (url.pathname === "/api/qvm/racing/filters" && request.method === "POST") return json(await saveFilter(env, await request.json().catch(() => ({}))), 201);
  if (url.pathname === "/api/qvm/racing/alerts" && request.method === "GET") return json({ alerts: await listAlerts(env) });
  if (url.pathname === "/api/qvm/racing/alerts" && request.method === "POST") return json(await saveAlert(env, await request.json().catch(() => ({}))), 201);
  if (url.pathname === "/api/qvm/racing/alerts/ack" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = body.id;
    if (await ensureSchema(env)) await database(env).prepare("UPDATE racing_alerts SET status='ACKNOWLEDGED' WHERE id=?").bind(id).run();
    else { const alert = memory.alerts.find((item) => item.id === id); if (alert) alert.status = "ACKNOWLEDGED"; }
    return json({ ok: true, id });
  }
  if (url.pathname === "/api/qvm/racing/watchlist" && request.method === "GET") return json({ watchlist: await listWatchlist(env, visitorId) });
  if (url.pathname === "/api/qvm/racing/watchlist" && request.method === "POST") {
    const item = await saveWatchlist(env, await request.json().catch(() => ({})), visitorId);
    return item ? json(item, 201) : json({ error: "RACE_ID_REQUIRED" }, 400);
  }
  if (url.pathname === "/api/qvm/racing/lifecycle" && request.method === "GET") return json({ lifecycle: await listLifecycle(env, url.searchParams.get("raceId")) });
  if (url.pathname === "/api/qvm/racing/lifecycle" && request.method === "POST") {
    const item = await saveLifecycle(env, await request.json().catch(() => ({})));
    return item ? json(item, 201) : json({ error: "INVALID_RACE_LIFECYCLE" }, 400);
  }
  if (url.pathname === "/api/qvm/racing/ai" && request.method === "POST") return openAiAnswer(request, env, visitorId);
  if (url.pathname === "/api/qvm/racing/weather" && request.method === "GET") {
    try { return await openMeteoWeather(url); } catch (error) { return json({ error: "OPEN_METEO_UNAVAILABLE", message: error.message }, 503); }
  }
  if (url.pathname === "/api/qvm/racing/irishracing-odds/batch" && request.method === "POST") return loadIrishRacingOddsBatch(env, await request.json().catch(() => ({})), visitorId);
  if (url.pathname === "/api/qvm/racing/irishracing-odds" && request.method === "POST") return loadIrishRacingOdds(env, await request.json().catch(() => ({})));
  if (url.pathname === "/api/qvm/racing/fixtures" && request.method === "GET") {
    const regions = (url.searchParams.get("regions") || "gb,ire").split(",").filter(Boolean);
    const startedAt = Date.now();
    const days = requestedFixtureDays(url);
    const dayResults = await Promise.all(days.map((day) => racingFixtureDay(env, day, regions)));
    const successes = dayResults.filter((result) => !(result.payload instanceof Response));
    const failures = dayResults.filter((result) => result.payload instanceof Response);
    if (!successes.length) {
      const lastFailure = failures[failures.length - 1];
      const message = lastFailure?.message || "Racecards unavailable";
      await saveProviderHealth(env, { provider: "the-racing-api", status: "DEGRADED", latencyMs: Date.now() - startedAt, message });
      await saveAlert(env, { kind: "PROVIDER_FAILURE", title: "Fixture provider unavailable", message });
      return lastFailure?.payload || json({ error: "RACING_API_UNAVAILABLE", message }, 503);
    }

    const lifecycle = new Map((await listLifecycle(env)).map((item) => [item.raceId, item]));
    const settings = await getSettings(env);
    const records = [];
    for (const result of successes) {
      for (const card of Array.isArray(result.payload.racecards) ? result.payload.racecards : []) {
        const fixture = normalizeRacingCard(card, result.day);
        const state = lifecycle.get(fixture.providerRaceId);
        records.push({ fixture: state ? { ...fixture, status: state.status, lifecycle: state } : fixture, oddsAvailable: result.oddsAvailable });
      }
    }
    const uniqueRecords = [];
    const seen = new Set();
    for (const record of records) {
      const fixture = record.fixture;
      const key = String(fixture.providerRaceId || `${fixture.fixtureDay}:${fixture.venue}:${fixture.scheduledOffAt}`);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueRecords.push(record);
    }
    const storedQuotes = await listQuoteSnapshots(env);
    const quotesByRace = new Map();
    for (const quote of storedQuotes) {
      const key = String(quote.raceId);
      if (!quotesByRace.has(key)) quotesByRace.set(key, []);
      quotesByRace.get(key).push(quote);
    }
    let recordCursor = 0;
    const enrichRecord = async () => {
      while (true) {
        const currentIndex = recordCursor++;
        const record = uniqueRecords[currentIndex];
        if (!record) return;
        let fixture = record.fixture;
        const activeRunners = fixture.runners.filter((runner) => !["WITHDRAWN", "NON_RUNNER", "NR"].includes(String(runner.status || "").toUpperCase()));
        const complete = record.oddsAvailable && activeRunners.length >= 2 && activeRunners.every((runner) => Number(runner.odds) > 1);
        const existingQuotes = quotesByRace.get(String(fixture.providerRaceId)) || [];
        const reusableQuotes = existingQuotes.filter((quote) => quoteAgeSeconds(quote.capturedAt, now()) <= Number(settings.maxQuoteAgeSeconds || 300));
        const existingQuote = reusableQuotes.find((quote) => quote.provider === "irishracing.com") || reusableQuotes.find((quote) => quote.provider === "the-racing-api") || null;
        if (existingQuote) {
          fixture = mergeQuoteIntoFixture(fixture, existingQuote);
          fixture.quoteCapturedAt = existingQuote.capturedAt;
          fixture.quoteAgeSeconds = quoteAgeSeconds(existingQuote.capturedAt, now());
          fixture.quoteSourceUpdatedAt = existingQuote.sourceUpdatedAt;
          fixture.paperDecision = decisionFromQuote(existingQuote, settings, null, fixture);
          fixture.decisionContract = fixture.paperDecision;
          record.oddsAvailable = true;
          await saveDecisionSnapshot(env, fixture.paperDecision);
        } else if (complete) {
          const capturedAt = now();
          const sourceUpdatedAt = activeRunners.map((runner) => runner.oddsUpdatedAt).find(Boolean) || capturedAt;
          const saved = await saveQuoteSnapshot(env, { raceId: fixture.providerRaceId, venue: fixture.venue, scheduledOffAt: fixture.scheduledOffAt, provider: "the-racing-api", capturedAt, sourceUpdatedAt, runners: fixture.runners.map((runner) => ({ runnerId: runner.providerRunnerId, odds: runner.odds, horseName: runner.horseName, status: runner.status, modelProbability: runner.modelProbability, oddsBookmaker: runner.oddsBookmaker, oddsUpdatedAt: runner.oddsUpdatedAt })) });
          if (saved.ok) {
            fixture.quoteCapturedAt = capturedAt;
            fixture.quoteAgeSeconds = quoteAgeSeconds(capturedAt, now());
            fixture.quoteSourceUpdatedAt = sourceUpdatedAt;
            fixture.paperDecision = decisionFromQuote(saved.snapshot, settings, null, fixture);
            fixture.decisionContract = fixture.paperDecision;
            await saveDecisionSnapshot(env, fixture.paperDecision);
          }
        }
        if (!fixture.paperDecision) {
          fixture.paperDecision = blockedLiveDecision(settings, record.oddsAvailable ? "NO_COMPLETE_RUNNER_BOOK" : "ODDS_UNAVAILABLE");
          fixture.decisionContract = fixture.paperDecision;
        }
        record.fixture = fixture;
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, uniqueRecords.length) }, () => enrichRecord()));
    const fixtures = uniqueRecords.map((record) => record.fixture);
    const completeBooks = uniqueRecords.filter((record) => {
      const fixture = record.fixture;
      const activeRunners = fixture.runners.filter((runner) => !["WITHDRAWN", "NON_RUNNER", "NR"].includes(String(runner.status || "").toUpperCase()));
      return record.oddsAvailable && activeRunners.length >= 2 && activeRunners.every((runner) => Number(runner.odds) > 1);
    }).length;
    const notices = [
      ...successes.map((result) => result.oddsNotice),
      ...failures.map((result) => `Fixtures for ${result.day} unavailable: ${result.message}`)
    ].filter(Boolean);
    const notice = [...new Set(notices)].join(" ") || null;
    const oddsAvailable = !failures.length && successes.every((result) => result.oddsAvailable);
    await saveProviderHealth(env, { provider: "the-racing-api", status: notice ? "DEGRADED" : "HEALTHY", latencyMs: Date.now() - startedAt, message: notice || `Racecards loaded for ${days.join(" and ")}` });
    return json({ provider: "the-racing-api", mode: "upcoming", days, total: fixtures.length, fixtures, capturedAt: now(), evidence: { days, completeRunnerBooks: completeBooks, oddsAvailable, notice, failures: failures.map((result) => ({ day: result.day, status: result.payload.status, message: result.message })) } });
  }
  if (url.pathname === "/api/qvm/racing/history" && request.method === "GET") {
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const regions = (url.searchParams.get("regions") || "gb,ire").split(",").filter(Boolean);
    const startedAt = Date.now();
    let payload = await racingApiRequest(env, "/v1/results", { start_date: startDate, end_date: endDate, region: regions, limit: 100 });
    if (payload instanceof Response && payload.status >= 400 && startDate === endDate) {
      payload = await racingApiRequest(env, "/v1/results/today/free", { region: regions, limit: 100 });
      if (!(payload instanceof Response)) return json({ provider: "the-racing-api", mode: "today-free", historicalAvailable: false, notice: "Historical results require a Racing API Standard plan; today's free results feed is available.", total: payload.total || 0, results: payload.results || [], capturedAt: now() });
    }
    if (payload instanceof Response) { const message = "Results unavailable (" + payload.status + ")"; await saveProviderHealth(env, { provider: "the-racing-api", status: "DEGRADED", latencyMs: Date.now() - startedAt, message }); await saveAlert(env, { kind: "PROVIDER_FAILURE", title: "Results provider unavailable", message }); return payload; }
    await saveProviderHealth(env, { provider: "the-racing-api", status: "HEALTHY", latencyMs: Date.now() - startedAt, message: "Results loaded" });
    return json({ provider: "the-racing-api", mode: "historical", total: payload.total || 0, results: payload.results || [], capturedAt: now() });
  }
  if (url.pathname === "/api/qvm/racing/overview" && request.method === "GET") return json(await overview(env, visitorId));
  if (url.pathname === "/api/qvm/racing/scan" && request.method === "GET") return json({ modelVersion: "racing-logit-v2", candidates: [{ runnerId: null, action: "ABSTAIN", reasonCode: "NO_LIVE_QUOTE", reasons: ["MODEL_SCORE_MISSING", "INCOMPLETE_MARKET"] }] });
  if (url.pathname === "/api/qvm/racing/decision" && request.method === "GET") return json(await liveDecision(env, url.searchParams.get("raceId"), url.searchParams.get("runnerId")));
  if (url.pathname === "/api/qvm/racing/snapshots" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const snapshot = createServerSnapshot(body?.runnerId);
    if (!snapshot) return json({ error: "RUNNER_NOT_ACTIONABLE" }, 409);
    if (await ensureSchema(env)) {
      await database(env).prepare("INSERT INTO racing_decision_snapshots (id,runner_id,runner,venue,odds,model_probability,market_probability,data_quality,quote_age_seconds,model_version,decision_json,close_odds,outcome,created_at,data_cutoff_at,provenance_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(snapshot.id, snapshot.runnerId, snapshot.runner, snapshot.venue, snapshot.odds, snapshot.modelProbability, snapshot.marketProbability, snapshot.dataQuality, snapshot.quoteAgeSeconds, snapshot.modelVersion, JSON.stringify(snapshot.decision), null, null, snapshot.createdAt, snapshot.dataCutoffAt || snapshot.createdAt, JSON.stringify(snapshot.provenance || {})).run();
    } else memory.snapshots.push(snapshot);
    return json(snapshot, 201);
  }
  if (url.pathname === "/api/qvm/racing/snapshots" && request.method === "GET") {
    if (await ensureSchema(env)) {
      const result = await database(env).prepare("SELECT * FROM racing_decision_snapshots ORDER BY created_at DESC LIMIT 100").all();
      return json({ snapshots: (result.results || []).map(snapshotFromRow) });
    }
    return json({ snapshots: memory.snapshots });
  }
  if (url.pathname === "/api/qvm/racing/replay" && request.method === "GET") {
    const snapshotId = url.searchParams.get("snapshotId");
    let snapshot = null;
    if (await ensureSchema(env)) {
      const row = await database(env).prepare("SELECT * FROM racing_decision_snapshots WHERE id=?").bind(snapshotId).first();
      if (row) snapshot = snapshotFromRow(row);
    } else snapshot = memory.snapshots.find((item) => item.id === snapshotId) || null;
    if (!snapshot) return json({ error: "SNAPSHOT_NOT_FOUND" }, 404);
    return json({ snapshot, replayedAt: now(), deterministic: true, note: "This replay uses the recorded decision inputs; no later information is added." });
  }
  if (url.pathname === "/api/qvm/racing/market-movement" && request.method === "GET") {
    const runnerId = url.searchParams.get("runnerId");
    const snapshots = database(env) && await ensureSchema(env) ? (await database(env).prepare("SELECT * FROM racing_decision_snapshots WHERE runner_id=? ORDER BY created_at DESC LIMIT 1").bind(runnerId).all()).results.map(snapshotFromRow) : memory.snapshots.filter((snapshot) => snapshot.runnerId === runnerId).slice(-1);
    const latest = snapshots[0] || null;
    const quotes = await listQuoteSnapshots(env, url.searchParams.get("raceId"));
    const movement = oddsMovement(quotes.flatMap((quote) => quote.runners.filter((runner) => !runnerId || runner.runnerId === runnerId).map((runner) => ({ ...runner, capturedAt: quote.capturedAt, snapshotId: quote.id }))));
    return json({ runnerId, selectionOdds: latest?.odds || movement.at(-1)?.odds || null, closeOdds: latest?.closeOdds || null, closingLineValue: latest?.closeOdds ? closingLineValue(latest.odds, latest.closeOdds) : null, movement, sampleStatus: latest?.closeOdds ? "READY" : "INSUFFICIENT_DATA" });
  }
  if (url.pathname === "/api/qvm/racing/analysis" && request.method === "GET") {
    const positions = await positionsForAnalytics(env, visitorId);
    const performance = performanceMetrics(positions);
    return json({ performance, quotes: await listQuoteSnapshots(env, url.searchParams.get("raceId")), providerHealth: await providerHealth(env), generatedAt: now() });
  }
  if (url.pathname === "/api/qvm/racing/paper-positions" && request.method === "GET") {
    if (await ensureSchema(env)) {
      const result = await database(env).prepare("SELECT * FROM racing_paper_positions WHERE visitor_id=? ORDER BY created_at DESC").bind(visitorId).all();
      return json({ positions: (result.results || []).map((row) => ({ ...row, runnerId: row.runner_id, raceId: row.race_id || null, snapshotId: row.snapshot_id || null })) });
    }
    return json({ positions: memory.positions.filter((position) => (position.visitorId || DEFAULT_VISITOR_ID) === visitorId) });
  }
  if (url.pathname === "/api/qvm/racing/paper-positions" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.runnerId) return json({ error: "NOT_ACTIONABLE" }, 409);
    const settings = await getSettings(env);
    const raceId = String(body.raceId || "") || null;
    if (!raceId) return json({ error: "RACE_ID_REQUIRED", message: "A paper position must be tied to a live race decision snapshot." }, 409);
    const live = await liveDecision(env, raceId, body.runnerId);
    if (live.decision.status !== "PAPER_CANDIDATE") return json({ error: "NOT_ACTIONABLE", message: "Paper betting is blocked until all evidence gates pass.", reasons: live.decision.reasons }, 409);
    if (!live.runner.runnerId) return json({ error: "RUNNER_NOT_FOUND" }, 404);
    const selected = live.runner;
    const existing = await positionsForAnalytics(env, visitorId);
    const duplicate = existing.find((position) => position.status === "OPEN" && String(position.raceId || "") === raceId && String(position.runnerId) === String(selected.runnerId));
    if (duplicate) return json({ ...duplicate, duplicate: true }, 200);
    const openExposure = existing.filter((position) => position.status === "OPEN").reduce((sum, position) => sum + Number(position.stake || 0), 0);
    const fixtureExposure = existing.filter((position) => position.status === "OPEN" && String(position.raceId || "") === String(raceId || "")).reduce((sum, position) => sum + Number(position.stake || 0), 0);
    const stakeDecision = calculateStake({ probability: selected.probability, odds: selected.odds, bankroll: settings.bankroll, maxStakePct: settings.maxStakePct, maxTotalExposurePct: settings.maxTotalExposurePct, maxFixtureExposurePct: settings.maxFixtureExposurePct, openExposure, fixtureExposure });
    if (!stakeDecision.allowed) return json({ error: "RISK_LIMIT", reason: stakeDecision.reason }, 409);
    const snapshot = await saveDecisionSnapshot(env, live);
    if (!snapshot) return json({ error: "SNAPSHOT_NOT_AVAILABLE" }, 503);
    const position = { id: ["paper-", crypto.randomUUID()].join(""), visitorId, runnerId: selected.runnerId, runner: selected.runner, venue: selected.venue, odds: selected.odds, probability: selected.probability, edge: selected.edge ?? null, raceId, snapshotId: snapshot.id, stake: Number(body.stake) > 0 ? Math.min(Number(body.stake), stakeDecision.stake) : stakeDecision.stake, status: "OPEN", evidenceMode: "LIVE_PROVIDER_QUOTE", segment: segmentKey(live?.quote || {}), dataQuality: selected.dataQuality, slippage: null, createdAt: now() };
    if (position.stake <= 0) return json({ error: "STAKE_REQUIRED" }, 409);
    if (await ensureSchema(env)) {
      await database(env).prepare("INSERT INTO racing_paper_positions (id,visitor_id,runner_id,runner,venue,odds,probability,stake,status,created_at,snapshot_id,race_id,segment,data_quality,slippage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(position.id, position.visitorId, position.runnerId, position.runner, position.venue, position.odds, position.probability, position.stake, position.status, position.createdAt, position.snapshotId, position.raceId || null, position.segment, position.dataQuality, null).run();
    } else {
      memory.positions.push(position);
    }
    return json(position, 201);
  }
  if (url.pathname === "/api/qvm/racing/settle" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const allowedOutcomes = ["WON", "LOST", "VOID", "NON_RUNNER"];
    if (!allowedOutcomes.includes(String(body?.outcome || "").toUpperCase())) return json({ error: "AMBIGUOUS_OUTCOME", message: "Choose WON, LOST, VOID, or NON_RUNNER before settling." }, 400);
    const outcome = String(body.outcome).toUpperCase();
    if (await ensureSchema(env)) {
      const row = await database(env).prepare("SELECT * FROM racing_paper_positions WHERE id=? AND visitor_id=?").bind(body?.positionId, visitorId).first();
      if (!row) return json({ error: "POSITION_NOT_FOUND" }, 404);
      if (row.status === "SETTLED") return json(row);
      const closeOdds = Number(body.closeOdds) > 1 ? Number(body.closeOdds) : null;
      const slippage = closeOdds ? closeOdds - Number(row.odds) : null;
      const pnl = outcome === "WON" ? row.stake * (row.odds - 1) - .2 : outcome === "LOST" ? -row.stake - .2 : 0;
      await database(env).prepare("UPDATE racing_paper_positions SET status='SETTLED', outcome=?, pnl=?, close_odds=?, slippage=? WHERE id=?").bind(outcome, pnl, closeOdds, slippage, body.positionId).run();
      if (row.snapshot_id) await database(env).prepare("UPDATE racing_decision_snapshots SET outcome=?, close_odds=? WHERE id=?").bind(outcome, closeOdds, row.snapshot_id).run();
      return json({ ...row, status: "SETTLED", outcome, pnl, closeOdds, slippage });
    }
    const position = memory.positions.find((p) => p.id === body?.positionId && (p.visitorId || DEFAULT_VISITOR_ID) === visitorId);
    if (!position) return json({ error: "POSITION_NOT_FOUND" }, 404);
    if (position.status === "SETTLED") return json(position);
    position.status = "SETTLED"; position.outcome = outcome; position.closeOdds = Number(body.closeOdds) > 1 ? Number(body.closeOdds) : null; position.slippage = position.closeOdds ? position.closeOdds - position.odds : null; position.pnl = position.outcome === "WON" ? position.stake * (position.odds - 1) - .2 : position.outcome === "LOST" ? -position.stake - .2 : 0;
    return json(position);
  }
  if (url.pathname === "/api/qvm/racing/performance" && request.method === "GET") {
    return json(performanceMetrics(await positionsForAnalytics(env, visitorId)));
  }
  return null;
}

export default { async fetch(request, env) { const response = await api(request, env); if (response) return response; return env.ASSETS.fetch(request); } };
