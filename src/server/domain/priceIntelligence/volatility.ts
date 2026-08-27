import type { PriceHistoryEntry, Offer, PriceVolatility } from '../../../shared/types.js';
import { isTrustedHistoryEntry } from './types.js';

/**
 * 4. Price Volatility (Daily Best Trusted Price series)
 * Measures CV and price change frequency strictly on observed days without synthetic jumps.
 */
export function calculatePriceVolatility(
  history: PriceHistoryEntry[],
  currentBestOffer?: Offer
): PriceVolatility {
  // Group observations into daily minimums from trusted history
  const dailyMap = new Map<string, number>();

  for (const h of history) {
    if (isTrustedHistoryEntry(h)) {
      const day = h.recordedAt.slice(0, 10);
      const existing = dailyMap.get(day);
      if (existing === undefined || h.priceEur < existing) {
        dailyMap.set(day, h.priceEur);
      }
    }
  }

  if (currentBestOffer && currentBestOffer.priceEur > 0 && !currentBestOffer.isAnomaly && currentBestOffer.riskLevel !== 'HIGH') {
    const today = (currentBestOffer.lastObservedAt || currentBestOffer.fetchedAt).slice(0, 10);
    const existing = dailyMap.get(today);
    if (existing === undefined || currentBestOffer.priceEur < existing) {
      dailyMap.set(today, currentBestOffer.priceEur);
    }
  }

  const sortedDays = Array.from(dailyMap.keys()).sort();
  const prices = sortedDays.map(d => dailyMap.get(d)!);

  if (prices.length < 2) {
    return {
      score: 0.0,
      category: 'Stable',
      rawCv: 0.0,
      priceChangesCount: 0
    };
  }

  // Calculate mean and standard deviation
  const n = prices.length;
  const mean = prices.reduce((a, b) => a + b, 0) / n;
  const variance = prices.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const rawCv = mean > 0 ? stdDev / mean : 0;

  // Count price changes >= 5% strictly between consecutive OBSERVED days
  let changesCount = 0;
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && Math.abs(curr - prev) / prev >= 0.05) {
      changesCount++;
    }
  }

  // Normalized score 0.0 to 1.0
  const score = Number(Math.min(1.0, rawCv * 2.0).toFixed(2));

  let category: 'Stable' | 'Moderate' | 'Volatile' = 'Moderate';
  if (rawCv < 0.12 && changesCount <= 2) {
    category = 'Stable';
  } else if (rawCv > 0.30 || changesCount > 6) {
    category = 'Volatile';
  }

  return {
    score,
    category,
    rawCv: Number(rawCv.toFixed(3)),
    priceChangesCount: changesCount
  };
}
