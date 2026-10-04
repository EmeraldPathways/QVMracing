const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

export function sampleStatus(count, minimum = 30) {
  return Number(count) >= minimum ? "READY" : "INSUFFICIENT_DATA";
}

function ordered(records = []) {
  return [...records].filter((record) => Number.isFinite(Number(record.odds)) && Number(record.odds) > 1)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function baseline(records, probabilityFor, minimum = 30) {
  const rows = ordered(records).map((record) => ({ probability: probabilityFor(record), outcome: record.outcome === "WON" ? 1 : 0, createdAt: record.createdAt }));
  const brier = rows.length ? rows.reduce((sum, row) => sum + ((row.probability - row.outcome) ** 2), 0) / rows.length : null;
  return { sampleCount: rows.length, sampleStatus: sampleStatus(rows.length, minimum), brierScore: brier == null ? null : round(brier), firstAt: rows[0]?.createdAt || null, lastAt: rows.at(-1)?.createdAt || null };
}

export function marketBaseline(records = [], minimum = 30) {
  return baseline(records, (record) => Math.min(.999, Math.max(.001, 1 / Number(record.odds))), minimum);
}

export function favouriteBaseline(records = [], minimum = 30) {
  const rows = ordered(records);
  const favouriteOdds = rows.length ? Math.min(...rows.map((record) => Number(record.odds))) : null;
  return baseline(rows.filter((record) => favouriteOdds != null && Number(record.odds) === favouriteOdds), () => favouriteOdds ? Math.min(.999, Math.max(.001, 1 / favouriteOdds)) : 0, minimum);
}

export function priceSensitivity({ probability, odds, costRate = .02 } = {}) {
  const p = Number(probability);
  const price = Number(odds);
  if (!(p > 0 && p < 1 && price > 1)) return { status: "UNAVAILABLE", current: null, minusFivePct: null, plusFivePct: null };
  const ev = (quote) => round((p * quote) - 1 - Number(costRate));
  return { status: "AVAILABLE", current: ev(price), minusFivePct: ev(price * .95), plusFivePct: ev(price * 1.05) };
}
