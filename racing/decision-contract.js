import { edgeDecision } from "./edge.js";
import { dataQualityScore } from "./analytics.js";

const CLOSED_STATUSES = new Set(["RUNNING", "FINISHED", "SETTLED", "ABANDONED", "VOID"]);
const ACTIVE_EXCLUSIONS = new Set(["WITHDRAWN", "NON_RUNNER", "NR"]);

const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableEvidenceId(prefix, values) {
  return `${prefix}-${stableHash(JSON.stringify(values))}`;
}

function stableRunnerValues(runner = {}) {
  return {
    runnerId: String(runner.runnerId || runner.providerRunnerId || ""),
    status: String(runner.status || "DECLARED").toUpperCase(),
    odds: Number.isFinite(Number(runner.odds)) ? Number(runner.odds) : null,
    modelProbability: Number.isFinite(Number(runner.modelProbability)) ? Number(runner.modelProbability) : null,
  };
}

export function quoteSnapshotId(snapshot = {}) {
  const runners = (Array.isArray(snapshot.runners) ? snapshot.runners : [])
    .map(stableRunnerValues)
    .sort((left, right) => left.runnerId.localeCompare(right.runnerId));
  return stableEvidenceId("quote", [
    String(snapshot.raceId || ""),
    String(snapshot.provider || ""),
    String(snapshot.capturedAt || ""),
    String(snapshot.sourceUpdatedAt || ""),
    runners,
  ]);
}

export function quoteAgeSeconds(capturedAt, referenceNow = new Date().toISOString()) {
  const captured = Date.parse(capturedAt || "");
  const reference = Date.parse(referenceNow || "");
  if (!Number.isFinite(captured) || !Number.isFinite(reference)) return Infinity;
  return Math.max(0, Math.floor((reference - captured) / 1000));
}

export function activeRunners(quote = {}) {
  return (Array.isArray(quote.runners) ? quote.runners : [])
    .filter((runner) => !ACTIVE_EXCLUSIONS.has(String(runner.status || "DECLARED").toUpperCase()));
}

function raceStarted(race = {}, quote = {}, referenceNow) {
  const status = String(race.status || "").toUpperCase();
  if (CLOSED_STATUSES.has(status)) return true;
  const scheduledOffAt = race.scheduledOffAt || race.scheduled_off_at || quote.scheduledOffAt;
  const off = Date.parse(scheduledOffAt || "");
  const reference = Date.parse(referenceNow || "");
  return Number.isFinite(off) && Number.isFinite(reference) && off <= reference;
}

function baseDecision(settings, dataMode, reasons = []) {
  const decision = edgeDecision({
    modelProbability: null,
    odds: null,
    marketProbability: null,
    quoteAgeSeconds: Infinity,
    dataQuality: 0,
    uncertainty: 1,
    completeBook: false,
    modelScore: false,
    raceNotStarted: false,
    maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds,
    minDataQuality: settings.minDataQuality,
  });
  decision.reasons = [...new Set([...decision.reasons, ...reasons])];
  decision.status = "ABSTAIN";
  return decision;
}

export function buildDecisionContract({ race = {}, quote = null, runnerId = null, settings = {}, now = new Date().toISOString() } = {}) {
  const active = activeRunners(quote || {});
  const validOdds = active.filter((runner) => Number.isFinite(Number(runner.odds)) && Number(runner.odds) > 1);
  const uniqueIds = new Set(active.map((runner) => String(runner.runnerId || "")).filter(Boolean));
  const completeBook = Boolean(quote && quote.completeBook && active.length >= 2 && validOdds.length === active.length && uniqueIds.size === active.length);
  const started = raceStarted(race, quote || {}, now);
  const selected = runnerId
    ? active.find((runner) => String(runner.runnerId) === String(runnerId))
    : validOdds[0] || active[0] || null;
  const capturedAt = quote?.capturedAt || null;
  const age = quoteAgeSeconds(capturedAt, now);
  const quality = completeBook
    ? dataQualityScore({ runnerCount: validOdds.length, completeBook: true, quoteAgeSeconds: age, sourceTimestamp: Boolean(quote.sourceUpdatedAt), weatherLoaded: false, resultStatus: race.status || "OPEN" })
    : 0;
  const modelProbability = Number(selected?.modelProbability);
  const modelScore = Number.isFinite(modelProbability) && modelProbability > 0 && modelProbability < 1;
  const reasons = [];
  if (!completeBook) reasons.push("INCOMPLETE_MARKET");
  if (!selected) reasons.push("RUNNER_NOT_FOUND");
  if (!modelScore) reasons.push("MODEL_SCORE_MISSING");
  if (started) reasons.push("RACE_STARTED");

  let decision;
  let marketProbability = null;
  let blendedProbability = null;
  if (completeBook && selected && Number.isFinite(Number(selected.odds)) && Number(selected.odds) > 1) {
    const totalImplied = validOdds.reduce((sum, runner) => sum + (1 / Number(runner.odds)), 0);
    marketProbability = (1 / Number(selected.odds)) / totalImplied;
    blendedProbability = modelScore ? round((modelProbability * Number(settings.modelWeight ?? 1)) + (marketProbability * (1 - Number(settings.modelWeight ?? 1)))) : null;
    decision = edgeDecision({
      modelProbability: blendedProbability,
      odds: Number(selected.odds),
      marketProbability,
      quoteAgeSeconds: age,
      dataQuality: quality,
      uncertainty: modelScore ? Math.max(.04, 1 - quality / 100) : 1,
      completeBook,
      modelScore,
      raceNotStarted: !started,
      maxQuoteAgeSeconds: settings.maxQuoteAgeSeconds ?? 300,
      minDataQuality: settings.minDataQuality ?? 70,
    });
    decision.reasons = [...new Set([...decision.reasons, ...reasons])];
    if (reasons.length) decision.status = "ABSTAIN";
  } else {
    decision = baseDecision(settings, "NO_COMPLETE_RUNNER_BOOK", reasons);
  }

  const contractRaceId = String(race.raceId || race.providerRaceId || race.provider_race_id || quote?.raceId || "");
  const contractRunner = selected ? {
    runnerId: String(selected.runnerId || selected.providerRunnerId || ""),
    horseName: selected.horseName || selected.runner || "Unnamed runner",
    odds: Number.isFinite(Number(selected.odds)) ? Number(selected.odds) : null,
    modelProbability: modelScore ? modelProbability : null,
    probability: blendedProbability,
    dataQuality: quality,
    status: selected.status || "DECLARED",
  } : { runnerId: null, horseName: "No runner selected", odds: null, modelProbability: null, probability: null, dataQuality: quality, status: "UNKNOWN" };
  const decisionId = quote?.id && contractRunner.runnerId
    ? stableEvidenceId("decision", [quote.id, contractRunner.runnerId, "racing-logit-v2"])
    : null;
  return {
    contractVersion: "qvm-racing-decision.v2",
    decisionId,
    race: {
      raceId: contractRaceId,
      venue: race.venue || quote?.venue || null,
      scheduledOffAt: race.scheduledOffAt || race.scheduled_off_at || quote?.scheduledOffAt || null,
      status: race.status || "SCHEDULED",
    },
    runner: contractRunner,
    decision: { ...decision, modelProbability: blendedProbability },
    gates: { ...decision.gates, completeBook, modelScore, raceNotStarted: !started },
    paperAction: { enabled: decision.status === "PAPER_CANDIDATE", label: decision.status === "PAPER_CANDIDATE" ? "PAPER CANDIDATE" : "ABSTAIN" },
    quote: quote ? {
      id: quote.id || quoteSnapshotId(quote),
      raceId: quote.raceId || contractRaceId,
      provider: quote.provider || "unknown",
      capturedAt: quote.capturedAt || null,
      asOf: quote.capturedAt || null,
      sourceUpdatedAt: quote.sourceUpdatedAt || null,
      completeBook,
    } : null,
    quoteAgeSeconds: Number.isFinite(age) ? age : null,
    source: quote?.provider || "unavailable",
    capturedAt: now,
    modelVersion: "racing-logit-v2",
  };
}

