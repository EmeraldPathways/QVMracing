const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function timestamp(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error("INVALID_TIMESTAMP");
  return parsed;
}

export function validateQuoteSnapshot(snapshot = {}, referenceNow = new Date().toISOString()) {
  const errors = [];
  let captured;
  try { captured = timestamp(snapshot.capturedAt); } catch { errors.push("INVALID_CAPTURED_AT"); }
  try {
    if (captured && captured > timestamp(referenceNow)) errors.push("CAPTURED_AT_IN_FUTURE");
  } catch { errors.push("INVALID_REFERENCE_TIME"); }
  if (!String(snapshot.raceId || "").trim()) errors.push("RACE_ID_REQUIRED");
  const seen = new Set();
  for (const runner of Array.isArray(snapshot.runners) ? snapshot.runners : []) {
    const runnerStatus = String(runner.status || "DECLARED").toUpperCase();
    if (["WITHDRAWN", "NON_RUNNER", "NR"].includes(runnerStatus)) continue;
    const id = String(runner.runnerId || "");
    const odds = Number(runner.odds);
    if (!id) errors.push("RUNNER_ID_REQUIRED");
    else if (seen.has(id)) errors.push("DUPLICATE_RUNNER");
    else seen.add(id);
    if (!Number.isFinite(odds) || odds <= 1) errors.push("INVALID_ODDS");
  }
  if (seen.size < 2) errors.push("INCOMPLETE_BOOK");
  return { valid: errors.length === 0, errors: [...new Set(errors)], runnerCount: seen.size };
}

export function featureProvenance({ race = {}, quote = null, weather = null, modelVersion = "unknown", cutoffAt = new Date().toISOString() } = {}) {
  const feature = (name, value, source, available = value !== null && value !== undefined && value !== "") => ({
    name,
    value: available ? value : null,
    available,
    source: source || "unavailable",
    cutoffAt
  });
  return {
    modelVersion,
    cutoffAt,
    features: [
      feature("course", race.venue || race.course, race.provider || "race fixture"),
      feature("discipline", race.discipline, race.provider || "race fixture"),
      feature("distance", race.distanceMeters || race.distance, race.provider || "race fixture"),
      feature("going", race.going, race.provider || "race fixture"),
      feature("surface", race.surface, race.provider || "race fixture"),
      feature("field_size", race.fieldSize || race.runners?.length, race.provider || "race fixture"),
      feature("quote_snapshot", quote?.id, quote?.provider, Boolean(quote?.id)),
      feature("weather", weather?.observation || weather, weather?.provider, Boolean(weather)),
      feature("trainer_jockey_form", null, "not supplied by current provider", false)
    ]
  };
}

export function calculateStake({ probability, odds, bankroll, maxStakePct = .1, maxTotalExposurePct = .3, maxFixtureExposurePct = .1, openExposure = 0, fixtureExposure = 0, quarterKelly = .25 } = {}) {
  const p = Number(probability); const price = Number(odds); const cash = Number(bankroll);
  if (!(p > 0 && p < 1 && price > 1 && cash > 0)) return { allowed: false, stake: 0, reason: "INVALID_STAKING_INPUT" };
  const availableTotal = Math.max(0, cash * Number(maxTotalExposurePct) - Number(openExposure || 0));
  const availableFixture = Math.max(0, cash * Number(maxFixtureExposurePct) - Number(fixtureExposure || 0));
  if (availableTotal <= 0) return { allowed: false, stake: 0, reason: "TOTAL_EXPOSURE_CAP" };
  if (availableFixture <= 0) return { allowed: false, stake: 0, reason: "FIXTURE_EXPOSURE_CAP" };
  const b = price - 1;
  const kelly = Math.max(0, ((p * price) - 1) / b) * Number(quarterKelly);
  const stake = round(Math.min(cash * Number(maxStakePct), availableTotal, availableFixture, cash * kelly), 2);
  if (stake <= 0) return { allowed: false, stake: 0, reason: "NO_POSITIVE_KELLY" };
  return { allowed: true, stake, reason: null, kellyFraction: round(kelly) };
}

export function marketBlend({ modelProbability, marketProbability, modelWeight = .5 } = {}) {
  const model = Number(modelProbability); const market = Number(marketProbability);
  if (!Number.isFinite(model) || !Number.isFinite(market)) return null;
  const weight = Math.min(1, Math.max(0, Number(modelWeight)));
  return round((model * weight) + (market * (1 - weight)));
}

export function segmentCalibration(records = []) {
  const groups = {};
  for (const record of records) {
    const segment = String(record.segment || "UNKNOWN");
    if (!groups[segment]) groups[segment] = { count: 0, predictedRate: 0, observedRate: 0 };
    groups[segment].count += 1;
    groups[segment].predictedRate += Number(record.probability) || 0;
    groups[segment].observedRate += Number(record.outcome) ? 1 : 0;
  }
  for (const value of Object.values(groups)) {
    value.predictedRate = round(value.predictedRate / value.count);
    value.observedRate = round(value.observedRate / value.count);
  }
  return groups;
}

export function oddsMovement(quotes = []) {
  return [...quotes].sort((a, b) => timestamp(a.capturedAt) - timestamp(b.capturedAt)).map((quote, index, rows) => ({
    ...quote,
    odds: Number(quote.odds),
    changeFromPrevious: index === 0 ? null : round(Number(quote.odds) - Number(rows[index - 1].odds), 2),
    impliedProbability: Number(quote.odds) > 1 ? round(1 / Number(quote.odds)) : null
  }));
}

export function equitySeries(positions = []) {
  let equity = 0; let peak = 0;
  return [...positions].sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt)).map((position) => {
    equity = round(equity + (Number(position.pnl) || 0), 2);
    peak = Math.max(peak, equity);
    return { createdAt: position.createdAt, pnl: Number(position.pnl) || 0, equity, drawdown: round(peak - equity, 2) };
  });
}

export function dataQualityScore({ runnerCount = 0, completeBook = false, quoteAgeSeconds = Infinity, sourceTimestamp = false, weatherLoaded = false, resultStatus = "UNKNOWN" } = {}) {
  let score = 0;
  if (completeBook) score += 30;
  if (Number(runnerCount) >= 4) score += 20;
  if (Number(quoteAgeSeconds) <= 30) score += 20;
  else if (Number(quoteAgeSeconds) <= 300) score += 10;
  if (sourceTimestamp) score += 15;
  if (weatherLoaded) score += 15;
  if (["DECLARED", "OPEN", "FINISHED"].includes(String(resultStatus).toUpperCase())) score += 5;
  return Math.min(100, score);
}

export function segmentKey(race = {}) {
  const surface = String(race.surface || "UNKNOWN").toUpperCase();
  const distance = Number(race.distanceMeters);
  const distanceBand = !Number.isFinite(distance) ? "UNKNOWN" : distance < 1400 ? "SPRINT" : distance < 2200 ? "MIDDLE" : "STAY";
  return `${surface}|${distanceBand}|${String(race.going || "UNKNOWN").toUpperCase()}`;
}

export function driftReport(current = [], baseline = [], threshold = .05) {
  const mean = (rows) => rows.length ? rows.reduce((sum, row) => sum + Number(row.probability || 0), 0) / rows.length : null;
  const currentMean = mean(current); const baselineMean = mean(baseline);
  const delta = currentMean == null || baselineMean == null ? null : round(currentMean - baselineMean);
  return { currentCount: current.length, baselineCount: baseline.length, currentMean: currentMean == null ? null : round(currentMean), baselineMean: baselineMean == null ? null : round(baselineMean), delta, drifted: delta != null && Math.abs(delta) >= threshold };
}
