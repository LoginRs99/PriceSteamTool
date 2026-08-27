import type { PriceHistoryEntry, TypicalSalePrice } from '../../../shared/types.js';

/**
 * 2. Typical Sale Price with Statistical IQR Outlier Protection
 * Considers discounted history points without rigid 10% cutoff, filtering outliers via IQR.
 */
export function calculateTypicalSalePrice(
  basePriceEur: number | undefined,
  history: PriceHistoryEntry[]
): TypicalSalePrice {
  if (!basePriceEur || basePriceEur <= 0) {
    return {
      medianPriceEur: null,
      sampleCount: 0,
      isLowConfidence: true
    };
  }

  // Filter candidate sale points: discount >= 15% OR price <= 85% of MSRP
  const saleThreshold = basePriceEur * 0.85;
  const candidates = history
    .filter(h => h.priceEur > 0 && (h.priceEur <= saleThreshold || (h.discountPercent && h.discountPercent >= 15)))
    .map(h => h.priceEur);

  if (candidates.length === 0) {
    return {
      medianPriceEur: null,
      sampleCount: 0,
      isLowConfidence: true
    };
  }

  if (candidates.length < 3) {
    // 1 or 2 points: simple median
    candidates.sort((a, b) => a - b);
    const mid = Math.floor(candidates.length / 2);
    const median = candidates.length % 2 !== 0 
      ? candidates[mid] 
      : (candidates[mid - 1] + candidates[mid]) / 2;

    return {
      medianPriceEur: Number(median.toFixed(2)),
      sampleCount: candidates.length,
      isLowConfidence: true
    };
  }

  // Calculate Q1, Q3, and IQR for outlier removal
  candidates.sort((a, b) => a - b);
  const q1Index = Math.floor(candidates.length * 0.25);
  const q3Index = Math.floor(candidates.length * 0.75);
  const q1 = candidates[q1Index];
  const q3 = candidates[q3Index];
  const iqr = q3 - q1;

  // Tukey's fences: filter out extreme lower outliers (e.g. glitches far below IQR)
  const lowerBound = q1 - 1.5 * iqr;
  const cleanCandidates = candidates.filter(p => p >= lowerBound);
  const finalPool = cleanCandidates.length > 0 ? cleanCandidates : candidates;

  const mid = Math.floor(finalPool.length / 2);
  const median = finalPool.length % 2 !== 0 
    ? finalPool[mid] 
    : (finalPool[mid - 1] + finalPool[mid]) / 2;

  const finalQ1 = finalPool[Math.floor(finalPool.length * 0.25)];
  const finalQ3 = finalPool[Math.floor(finalPool.length * 0.75)];

  return {
    medianPriceEur: Number(median.toFixed(2)),
    q1PriceEur: Number(finalQ1.toFixed(2)),
    q3PriceEur: Number(finalQ3.toFixed(2)),
    sampleCount: finalPool.length,
    isLowConfidence: false
  };
}
