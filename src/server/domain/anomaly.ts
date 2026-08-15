import type { Anomaly } from '../../shared/types.js';

export interface AnomalyEvaluationInput {
  priceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;
  historicalLowEur?: number;
  isOfficial: boolean;
  merchantTrustScore?: number;
  otherPrices?: number[];
}

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  type?: Anomaly['anomalyType'];
  reason?: string;
}

/**
 * Multi-signal price anomaly and glitch detector.
 * Crucial Rule: A new historical low is NOT automatically an anomaly.
 * An anomaly is flagged ONLY when pricing is suspiciously inconsistent with market realities.
 */
export function evaluateOfferAnomaly(input: AnomalyEvaluationInput): AnomalyResult {
  const {
    priceEur,
    originalPriceEur,
    basePriceEur,
    historicalLowEur,
    isOfficial,
    otherPrices = []
  } = input;

  const validOtherPrices = otherPrices.filter(p => p > 0);
  const msrp = basePriceEur || originalPriceEur || (validOtherPrices.length > 0 ? Math.max(...validOtherPrices) : 0);

  // 1. Extreme typo / sub-euro glitch on premium MSRP title
  // Example: €59.99 game sold for €0.50 on unofficial store while others sell for €45+
  if (msrp >= 29.99 && priceEur < 1.00 && !isOfficial) {
    return {
      isAnomaly: true,
      score: 0.95,
      type: 'EXTREME_DISCOUNT',
      reason: `Suspiciously low price (€${priceEur.toFixed(2)}) on a €${msrp.toFixed(2)} MSRP title from an unofficial merchant`
    };
  }

  // 2. Severe discrepancy against the market median
  // When at least 3 other stores report prices, check if this price is < 15% of the market median
  if (validOtherPrices.length >= 3) {
    const sorted = [...validOtherPrices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median >= 15.0 && priceEur < median * 0.15 && !isOfficial) {
      return {
        isAnomaly: true,
        score: 0.85,
        type: 'UNVERIFIED_MERCHANT_DISCREPANCY',
        reason: `Price (€${priceEur.toFixed(2)}) is over 85% below the store median (€${median.toFixed(2)})`
      };
    }
  }

  // 3. Glitch drop below historical low:
  // Legitimate new historical lows (e.g. 10-30% below previous low) are completely normal.
  // Flag only if price is > 85% below historical low on a high-value game with conflicting market prices.
  if (
    historicalLowEur && 
    historicalLowEur >= 20.0 && 
    priceEur < historicalLowEur * 0.15 && 
    !isOfficial &&
    validOtherPrices.length >= 2
  ) {
    return {
      isAnomaly: true,
      score: 0.80,
      type: 'SUDDEN_DROP',
      reason: `Price (€${priceEur.toFixed(2)}) is >85% below the all-time historical low (€${historicalLowEur.toFixed(2)}) on an unverified listing`
    };
  }

  // Default: Normal offer (or legitimate new historical low)
  return {
    isAnomaly: false,
    score: 0.0
  };
}
