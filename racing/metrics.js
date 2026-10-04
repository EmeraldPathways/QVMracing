const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

export function brierScore(probabilities, outcomeIndex) {
  return round(probabilities.reduce((sum, probability, index) => sum + ((Number(probability) - (index === outcomeIndex ? 1 : 0)) ** 2), 0));
}

export function logLoss(probability, epsilon = 1e-6) {
  const bounded = Math.min(1 - epsilon, Math.max(epsilon, Number(probability)));
  return round(-Math.log(bounded));
}

export function calibrationBins(records = [], binCount = 5) {
  const bins = Array.from({ length: binCount }, (_, index) => ({ lower: index / binCount, upper: (index + 1) / binCount, count: 0, predictedRate: 0, observedRate: 0 }));
  for (const record of records) {
    const probability = Number(record.probability);
    if (!Number.isFinite(probability)) continue;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(probability * binCount)));
    bins[index].count += 1;
    bins[index].predictedRate += probability;
    bins[index].observedRate += Number(record.outcome) ? 1 : 0;
  }
  return bins.map((bin) => ({ ...bin, predictedRate: bin.count ? round(bin.predictedRate / bin.count) : null, observedRate: bin.count ? round(bin.observedRate / bin.count) : null }));
}

export function drawdown(pnls = []) {
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const pnl of pnls) {
    equity += Number(pnl) || 0;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak - equity);
  }
  return round(worst);
}
