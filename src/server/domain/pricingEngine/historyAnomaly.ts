import type { SourceHistoryAnomalyResult } from './types.js';

export function evaluateSourceOwnHistoryAnomaly(
  currentPriceEur: number,
  sourceHistoryEur: number[]   // prior observed prices from this exact merchant, for this exact game, ordered oldest-to-newest
): SourceHistoryAnomalyResult {
  const MIN_OBSERVATIONS = 3;
  const Z_THRESHOLD = 2.5;

  if (sourceHistoryEur.length < MIN_OBSERVATIONS) {
    return { applicable: false, isBreak: false, zScore: null, ownMedian: null };
  }

  const sorted = [...sourceHistoryEur].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Mirror the IQR-fencing approach from calculateTypicalSalePrice
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = Math.max(0, q3 - q1);
  const scale = Math.max(iqr / 1.349, median * 0.03, 0.01);

  const z = (median - currentPriceEur) / scale; // positive = notably cheaper than own history
  const isBreak = Math.abs(z) > Z_THRESHOLD;

  return { applicable: true, isBreak, zScore: z, ownMedian: median };
}
