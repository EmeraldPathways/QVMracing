const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const memory = { positions: [], cycles: new Map() };
const candidate = { runnerId: "demo:horse:1", runner: "Alpha Meridian", venue: "Kempton 14:20", odds: 3.55, probability: .34, edge: .172, quoteAgeSeconds: 24, dataQuality: 95, action: "PAPER_CANDIDATE" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const now = () => new Date().toISOString();
const database = (env) => env?.QVM_RACING_DB;
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

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", "user-agent": "QVM-Racing-Workbench/1.0", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.detail || body.error || `Upstream request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
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
  const payload = await fetchJson(`${endpoint}?${params}`);
  return json({ provider: "open-meteo", mode: isHistorical ? "historical" : "forecast", latitude, longitude, raceTime, observation: nearestHourlyObservation(payload.hourly, raceTime), source: payload });
}

function racingApiAuth(env) {
  if (!env?.RACING_API_USERNAME || !env?.RACING_API_PASSWORD) return null;
  return `Basic ${btoa(`${env.RACING_API_USERNAME}:${env.RACING_API_PASSWORD}`)}`;
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

function normalizeRacingCard(card) {
  return {
    provider: "the-racing-api", providerRaceId: card.race_id, venue: card.course, country: card.region,
    scheduledOffAt: card.off_dt || `${card.date}T${card.off_time || "00:00"}:00`, distance: card.distance_round,
    going: card.going, surface: card.surface, fieldSize: Number(card.field_size) || (card.runners || []).length,
    status: card.is_abandoned ? "ABANDONED" : String(card.race_status || "SCHEDULED").toUpperCase(),
    sourceWeather: card.weather || null,
    runners: (card.runners || []).map((runner) => ({ providerRunnerId: runner.horse_id, horseName: runner.horse, number: runner.number, form: runner.form, status: runner.number === "NR" ? "WITHDRAWN" : "DECLARED", trainer: runner.trainer, jockey: runner.jockey, speedRating: runner.speed_rating, performanceRating: runner.performance_rating }))
  };
}

async function ensureSchema(env) {
  const db = database(env);
  if (!db) return false;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS racing_paper_positions (id TEXT PRIMARY KEY, runner_id TEXT NOT NULL, runner TEXT NOT NULL, venue TEXT NOT NULL, odds REAL NOT NULL, probability REAL NOT NULL, stake REAL NOT NULL, status TEXT NOT NULL, outcome TEXT, pnl REAL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS racing_sync_cycles (cycle_id TEXT PRIMARY KEY, counts_json TEXT NOT NULL, created_at TEXT NOT NULL)")
  ]);
  return true;
}

async function overview(env) {
  if (await ensureSchema(env)) {
    const row = await database(env).prepare("SELECT COUNT(*) AS count FROM racing_paper_positions WHERE status='OPEN'").first();
    return { provider: "demo", modelVersion: "racing-logit-v1", paperOnly: true, openPositions: row?.count || 0, heartbeat: { status: "READY" } };
  }
  return { provider: "demo", modelVersion: "racing-logit-v1", paperOnly: true, openPositions: memory.positions.filter((p) => p.status === "OPEN").length, heartbeat: { status: "READY" } };
}

async function api(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/qvm/racing/integrations" && request.method === "GET") {
    return json({ openMeteo: { provider: "open-meteo", configured: true, authentication: "none" }, racingApi: { provider: "the-racing-api", configured: Boolean(racingApiAuth(env)), authentication: "basic", credentials: ["RACING_API_USERNAME", "RACING_API_PASSWORD"] }, paperOnly: true });
  }
  if (url.pathname === "/api/qvm/racing/weather" && request.method === "GET") {
    try { return await openMeteoWeather(url); } catch (error) { return json({ error: "OPEN_METEO_UNAVAILABLE", message: error.message }, 503); }
  }
  if (url.pathname === "/api/qvm/racing/fixtures" && request.method === "GET") {
    const regions = (url.searchParams.get("regions") || "gb,ire").split(",").filter(Boolean);
    const payload = await racingApiRequest(env, "/v1/racecards/free", { day: url.searchParams.get("day") || "today", region_codes: regions, limit: 500 });
    if (payload instanceof Response) return payload;
    return json({ provider: "the-racing-api", mode: "upcoming", total: payload.total || 0, fixtures: (payload.racecards || []).map(normalizeRacingCard), capturedAt: now() });
  }
  if (url.pathname === "/api/qvm/racing/history" && request.method === "GET") {
    const payload = await racingApiRequest(env, "/v1/results", { start_date: url.searchParams.get("startDate"), end_date: url.searchParams.get("endDate"), region: (url.searchParams.get("regions") || "gb,ire").split(",").filter(Boolean), limit: 100 });
    if (payload instanceof Response) return payload;
    return json({ provider: "the-racing-api", mode: "historical", total: payload.total || 0, results: payload.results || [], capturedAt: now() });
  }
  if (url.pathname === "/api/qvm/racing/overview" && request.method === "GET") return json(await overview(env));
  if (url.pathname === "/api/qvm/racing/scan" && request.method === "GET") return json({ modelVersion: "racing-logit-v1", candidates: [candidate, { runnerId: "demo:horse:2", action: "ABSTAIN", reasonCode: "NEGATIVE_EDGE" }] });
  if (url.pathname === "/api/qvm/racing/paper-positions" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || body.runnerId !== candidate.runnerId) return json({ error: "NOT_ACTIONABLE" }, 409);
    const position = { id: `paper-${crypto.randomUUID()}`, ...candidate, stake: 20, status: "OPEN", createdAt: now() };
    if (await ensureSchema(env)) await database(env).prepare("INSERT INTO racing_paper_positions (id,runner_id,runner,venue,odds,probability,stake,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(position.id, position.runnerId, position.runner, position.venue, position.odds, position.probability, position.stake, position.status, position.createdAt).run();
    else memory.positions.push(position);
    return json(position, 201);
  }
  if (url.pathname === "/api/qvm/racing/settle" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (await ensureSchema(env)) {
      const row = await database(env).prepare("SELECT * FROM racing_paper_positions WHERE id=?").bind(body?.positionId).first();
      if (!row) return json({ error: "POSITION_NOT_FOUND" }, 404);
      if (row.status === "SETTLED") return json(row);
      const pnl = body.outcome === "WON" ? row.stake * (row.odds - 1) - .2 : body.outcome === "LOST" ? -row.stake - .2 : 0;
      await database(env).prepare("UPDATE racing_paper_positions SET status='SETTLED', outcome=?, pnl=? WHERE id=?").bind(body.outcome || "WON", pnl, body.positionId).run();
      return json({ ...row, status: "SETTLED", outcome: body.outcome || "WON", pnl });
    }
    const position = memory.positions.find((p) => p.id === body?.positionId);
    if (!position) return json({ error: "POSITION_NOT_FOUND" }, 404);
    if (position.status === "SETTLED") return json(position);
    position.status = "SETTLED"; position.outcome = body.outcome || "WON"; position.pnl = position.outcome === "WON" ? 50.8 : position.outcome === "LOST" ? -20.2 : 0;
    return json(position);
  }
  if (url.pathname === "/api/qvm/racing/performance" && request.method === "GET") {
    if (await ensureSchema(env)) {
      const row = await database(env).prepare("SELECT COUNT(*) AS count, COALESCE(SUM(pnl),0) AS pnl, COALESCE(SUM(stake),0) AS turnover FROM racing_paper_positions WHERE status='SETTLED'").first();
      return json({ settledPositions: row?.count || 0, netPaperPnl: row?.pnl || 0, turnover: row?.turnover || 0 });
    }
    const settled = memory.positions.filter((p) => p.status === "SETTLED");
    return json({ settledPositions: settled.length, netPaperPnl: settled.reduce((sum, p) => sum + (p.pnl || 0), 0), turnover: memory.positions.reduce((sum, p) => sum + p.stake, 0) });
  }
  if (url.pathname === "/api/qvm/racing/worker/sync" && request.method === "POST") {
    const secret = env?.QVM_RACING_WORKER_SHARED_SECRET;
    if (secret && request.headers.get("x-qvm-racing-worker-key") !== secret) return json({ error: "UNAUTHORIZED" }, 401);
    const body = await request.json().catch(() => null);
    if (!body?.cycleId) return json({ error: "INVALID_SYNC_PAYLOAD" }, 400);
    if (await ensureSchema(env)) {
      const existing = await database(env).prepare("SELECT counts_json FROM racing_sync_cycles WHERE cycle_id=?").bind(body.cycleId).first();
      if (existing) return json({ idempotent: true, cycleId: body.cycleId, counts: JSON.parse(existing.counts_json) });
      await database(env).prepare("INSERT INTO racing_sync_cycles (cycle_id,counts_json,created_at) VALUES (?,?,?)").bind(body.cycleId, JSON.stringify(body.counts || {}), now()).run();
      return json({ idempotent: false, cycleId: body.cycleId, counts: body.counts || {} }, 201);
    }
    if (memory.cycles.has(body.cycleId)) return json({ idempotent: true, cycleId: body.cycleId, counts: memory.cycles.get(body.cycleId) });
    memory.cycles.set(body.cycleId, body.counts || {});
    return json({ idempotent: false, cycleId: body.cycleId, counts: body.counts || {} }, 201);
  }
  return null;
}

export default { async fetch(request, env) { const response = await api(request, env); if (response) return response; return env.ASSETS.fetch(request); } };
