const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

export function normalizeBook(runners = []) {
  const seen = new Set();
  const normalized = [];
  for (const runner of runners) {
    const runnerId = String(runner.runnerId || "");
    const odds = Number(runner.odds);
    if (!runnerId || seen.has(runnerId)) return { complete: false, reason: "DUPLICATE_RUNNER" };
    if (!Number.isFinite(odds) || odds <= 1) return { complete: false, reason: "INVALID_ODDS" };
    seen.add(runnerId);
    normalized.push({ ...runner, runnerId, odds });
  }
  if (normalized.length < 2) return { complete: false, reason: "INCOMPLETE_BOOK" };
  const overround = normalized.reduce((sum, runner) => sum + (1 / runner.odds), 0);
  return {
    complete: true,
    overround: round(overround),
    runners: normalized.map((runner) => ({ ...runner, impliedProbability: round(1 / runner.odds), noVigProbability: round((1 / runner.odds) / overround) }))
  };
}

export function edgeDecision(input = {}) {
  const modelProbability = Number(input.modelProbability);
  const odds = Number(input.odds);
  const hasMarketProbability = input.marketProbability !== null && input.marketProbability !== undefined && input.marketProbability !== "";
  const marketProbability = Number(input.marketProbability);
  const quoteAgeSeconds = Number(input.quoteAgeSeconds);
  const dataQuality = Number(input.dataQuality);
  const uncertainty = Number.isFinite(Number(input.uncertainty)) ? Number(input.uncertainty) : 1 - (dataQuality / 100);
  const maxQuoteAgeSeconds = Number(input.maxQuoteAgeSeconds ?? 300);
  const minDataQuality = Number(input.minDataQuality ?? 70);
  const costRate = Number(input.costRate ?? .02);
  const reasons = [];
  const modelScore = input.modelScore === undefined ? (Number.isFinite(modelProbability) && modelProbability > 0 && modelProbability < 1) : Boolean(input.modelScore);
  const completeBook = input.completeBook === undefined ? true : Boolean(input.completeBook);
  const raceNotStarted = input.raceNotStarted === undefined ? true : Boolean(input.raceNotStarted);
  const gates = {
    validProbability: Number.isFinite(modelProbability) && modelProbability > 0 && modelProbability < 1,
    modelScore,
    validOdds: Number.isFinite(odds) && odds > 1,
    freshQuote: Number.isFinite(quoteAgeSeconds) && quoteAgeSeconds <= maxQuoteAgeSeconds,
    quality: Number.isFinite(dataQuality) && dataQuality >= minDataQuality,
    marketComplete: hasMarketProbability && Number.isFinite(marketProbability) && marketProbability > 0 && marketProbability < 1,
    uncertainty: Number.isFinite(uncertainty) && uncertainty <= .25,
    completeBook,
    raceNotStarted
  };
  if (!gates.validProbability || !gates.validOdds) reasons.push("INVALID_PRICE_OR_PROBABILITY");
  if (!gates.modelScore) reasons.push("MODEL_SCORE_MISSING");
  if (!gates.freshQuote) reasons.push("STALE_QUOTE");
  if (!gates.quality) reasons.push("LOW_DATA_QUALITY");
  if (!gates.marketComplete) reasons.push("INCOMPLETE_MARKET");
  if (!gates.uncertainty) reasons.push("HIGH_UNCERTAINTY");
  if (!gates.completeBook) reasons.push("INCOMPLETE_MARKET");
  if (!gates.raceNotStarted) reasons.push("RACE_STARTED");
  const fairOdds = gates.validProbability ? round(1 / modelProbability) : null;
  const expectedValue = gates.validProbability && gates.validOdds ? round((modelProbability * odds) - 1 - costRate) : null;
  gates.positiveEdge = Number.isFinite(expectedValue) && expectedValue > 0;
  if (!gates.positiveEdge) reasons.push("NO_POST_COST_EDGE");
  return {
    status: reasons.length === 0 ? "PAPER_CANDIDATE" : "ABSTAIN",
    fairOdds,
    noVigProbability: gates.marketComplete ? round(marketProbability) : null,
    expectedValue,
    uncertainty: round(uncertainty),
    gates,
    reasons: [...new Set(reasons)]
  };
}

export function closingLineValue(selectionOdds, closeOdds) {
  const selected = Number(selectionOdds);
  const close = Number(closeOdds);
  if (!Number.isFinite(selected) || !Number.isFinite(close) || selected <= 1 || close <= 1) return null;
  return round((selected / close) - 1);
}
