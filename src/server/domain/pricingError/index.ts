export * from './types.js';
export * from './detector.js';
export * from './priceEvents.js';

import { detectPricingError, getTriggeredSignals } from './detector.js';
import { detectPriceEvent } from './priceEvents.js';
import type { PricingErrorInput, PriceMovementInput, OfferAnomalyInput, PriceRiskInput } from './types.js';

/**
 * Re-exports and backward compatibility wrappers for evaluating price movements and store history.
 */
export function evaluateSourceOwnHistoryAnomaly(
  currentPriceEur: number,
  sourceHistoryEur: number[]
) {
  const MIN_OBSERVATIONS = 3;
  const Z_THRESHOLD = 2.5;

  if (!sourceHistoryEur || sourceHistoryEur.length < MIN_OBSERVATIONS) {
    return { applicable: false, isBreak: false, zScore: null, ownMedian: null };
  }

  const sorted = [...sourceHistoryEur].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = Math.max(0, q3 - q1);
  const scale = Math.max(iqr / 1.349, median * 0.08, 0.50);

  const z = (median - currentPriceEur) / scale;
  const isBreak = z > Z_THRESHOLD;

  return { applicable: true, isBreak, zScore: z, ownMedian: median };
}

export function evaluatePriceMovement(input: PriceMovementInput) {
  const price = input.currentPriceEur ?? input.priceEur ?? 0;
  const errorInput: PricingErrorInput = {
    priceEur: price,
    steamBasePriceEur: input.basePriceEur,
    claimedOriginalPriceEur: input.originalPriceEur,
    confirmedAtlEur: input.historicalLowEur ?? input.confirmedAtlEur,
    atlIsConfirmed: input.atlIsConfirmed ?? (input.isConfirmedAtl !== false),
    typicalSaleMedianEur: input.typicalSaleMedianEur ?? input.medianEur,
    otherFreshPricesEur: input.marketPricesEur ?? input.otherFreshPricesEur,
    independentMerchantCount: input.independentMerchantCount ?? ((input.sourceAgreementCount !== undefined && input.sourceAgreementCount >= 2 && input.isOfficialMerchant) ? 2 : undefined),
    ownHistoryEur: input.sourceHistoryEur,
    gameReleaseDate: input.gameReleaseDate,
    suspectedEditionInversion: input.suspectedEditionInversion,
    isDelisted: input.isDelisted,
    isUnreleased: input.isUnreleased
  };

  const errorEval = detectPricingError(errorInput);
  const rawSignals = getTriggeredSignals(errorInput);
  const event = detectPriceEvent(input, errorEval.isLikelyPricingError);

  const riskFlags: string[] = [];
  const riskLevel = errorEval.isLikelyPricingError
    ? 'HIGH'
    : (event === 'PRICE_INCREASE' ? 'SAFE' : (errorEval.confidence > 0.15 ? 'LOW' : 'SAFE'));
  const riskScore = errorEval.confidence;

  // Populate riskFlags with triggered signals & legacy aliases
  for (const s of rawSignals) {
    if (s.type === 'DECIMAL_SHIFT') {
      if (errorEval.isLikelyPricingError) {
        riskFlags.push('DECIMAL_SHIFT');
        if (price <= 1.005) {
          riskFlags.push('SUB_EURO_PREMIUM_GLITCH');
        }
      }
    } else if (s.type === 'MARKET_OUTLIER') {
      riskFlags.push('MARKET_OUTLIER', 'LONE_BOTTOM_OUTLIER', 'EXTREME_MEDIAN_OUTLIER');
    } else if (s.type === 'BELOW_ATL_IMPLAUSIBLE') {
      riskFlags.push('BELOW_ATL_IMPLAUSIBLE', 'HISTORICAL_LOW_DISCREPANCY');
    } else if (s.type === 'OWN_HISTORY_BREAK') {
      riskFlags.push('OWN_HISTORY_BREAK', 'SOURCE_OWN_HISTORY_BREAK');
    } else if (s.type === 'FRESH_RELEASE_DROP') {
      riskFlags.push('FRESH_RELEASE_DROP', 'FRESH_RELEASE_UNEXPECTED_DROP');
    } else if (s.type === 'EDITION_INVERSION') {
      riskFlags.push('EDITION_INVERSION');
    } else if (s.type === 'FAKE_BASELINE') {
      riskFlags.push('FAKE_BASELINE');
    }
  }

  // Check for corroborated signals
  if (!errorEval.isLikelyPricingError) {
    if (rawSignals.some(s => s.type === 'DECIMAL_SHIFT') && price <= 1.005) {
      riskFlags.push('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    }
    if (rawSignals.some(s => s.type === 'OWN_HISTORY_BREAK')) {
      riskFlags.push('SOURCE_OWN_HISTORY_BREAK_CORROBORATED');
    }
  }

  // Legacy context flags
  if (input.sourceAgreementCount === 1 && input.marketPricesEur && input.marketPricesEur.length >= 2) {
    riskFlags.push('SOURCE_DISAGREEMENT');
  }
  if (input.isStaleObservation) {
    riskFlags.push('STALE_OBSERVATION');
  }
  if (!input.basePriceEur && !input.originalPriceEur) {
    riskFlags.push('MISSING_MSRP_ANCHOR');
  }

  // Confidence calculation
  let confidence = Math.max(0.1, Math.min(1.0, 1 - errorEval.confidence));
  if (errorEval.isLikelyPricingError) {
    confidence = Math.min(confidence, 0.50);
  }
  if (input.isStaleObservation) {
    confidence = Math.min(confidence, 0.40);
  }
  if (!input.basePriceEur && !input.originalPriceEur) {
    confidence = Math.min(confidence, 0.35);
  }

  // Summary generation
  const EVENT_SUMMARIES: Record<string, string> = {
    RECORD_DROP: '🏆 Confirmed All-Time Low',
    UNCONFIRMED_RECORD_DROP: '⚡ Unconfirmed Record Drop',
    EXTREME_DROP: '🔥 Extreme Price Drop',
    MAJOR_DROP: '🔥 Major Price Drop',
    SIGNIFICANT_DROP: '✨ Significant Discount',
    MODERATE_DROP: '🏷️ On Sale',
    PRICE_INCREASE: '📈 Price Increased',
    PRICING_ERROR: '⚠️ Pricing Error',
    STANDARD: 'Standard Pricing'
  };

  let summary = EVENT_SUMMARIES[event] || 'Standard Pricing';
  if (errorEval.isLikelyPricingError && event === 'PRICING_ERROR') {
    if (price <= 1.005 && riskFlags.includes('SUB_EURO_PREMIUM_GLITCH')) {
      summary = '⚡ Sub-Euro Price Glitch (<€1.00)';
    } else if (riskFlags.includes('SOURCE_OWN_HISTORY_BREAK')) {
      summary = '⚠️ Merchant Own History Sudden Collapse';
    } else if (errorEval.reason && errorEval.reason.startsWith('Market outlier')) {
      summary = errorEval.reason;
    } else if (riskFlags.includes('LONE_BOTTOM_OUTLIER')) {
      summary = '⚠️ Lone Outlier (>50% below other stores)';
    } else if (errorEval.reason) {
      summary = errorEval.reason;
    }
  }

  return {
    event,
    riskLevel,
    riskScore,
    riskFlags: Array.from(new Set(riskFlags)),
    confidence,
    summary,
    isAnomaly: errorEval.isLikelyPricingError,
    isLikelyPricingError: errorEval.isLikelyPricingError,
    pricingErrorConfidence: errorEval.confidence,
    pricingErrorType: errorEval.type,
    pricingErrorReason: errorEval.reason
  };
}

export function evaluateOfferAnomaly(input: OfferAnomalyInput) {
  const price = input.priceEur ?? input.currentPriceEur ?? 0;
  const errorInput: PricingErrorInput = {
    priceEur: price,
    steamBasePriceEur: input.basePriceEur,
    claimedOriginalPriceEur: input.originalPriceEur,
    confirmedAtlEur: input.historicalLowEur ?? input.confirmedAtlEur,
    atlIsConfirmed: input.atlIsConfirmed ?? (input.isConfirmedAtl !== false),
    typicalSaleMedianEur: input.typicalSaleMedianEur ?? input.medianEur,
    otherFreshPricesEur: input.otherPrices ?? input.marketPricesEur,
    independentMerchantCount: input.independentMerchantCount,
    gameReleaseDate: input.gameReleaseDate,
    isDelisted: input.isDelisted,
    isUnreleased: input.isUnreleased
  };

  const errorEval = detectPricingError(errorInput);
  const event = detectPriceEvent(input, errorEval.isLikelyPricingError);

  return {
    isAnomaly: errorEval.isLikelyPricingError,
    score: errorEval.confidence,
    type: errorEval.type ?? 'STANDARD',
    reason: errorEval.reason ?? 'Standard Pricing',
    evaluation: {
      event,
      isLikelyPricingError: errorEval.isLikelyPricingError,
      confidence: errorEval.confidence,
      type: errorEval.type,
      reason: errorEval.reason,
      riskLevel: errorEval.isLikelyPricingError ? 'HIGH' : 'SAFE',
      riskScore: errorEval.confidence,
      riskFlags: errorEval.type ? [errorEval.type] : [],
      summary: errorEval.reason ?? 'Standard Pricing',
      isAnomaly: errorEval.isLikelyPricingError
    }
  };
}

export function calculatePriceRisk(input: PriceRiskInput, flags?: Set<any>) {
  const errorInput: PricingErrorInput = {
    priceEur: input.currentPriceEur ?? input.priceEur ?? 0,
    steamBasePriceEur: input.basePriceEur,
    claimedOriginalPriceEur: input.originalPriceEur,
    confirmedAtlEur: input.historicalLowEur ?? input.confirmedAtlEur,
    atlIsConfirmed: input.atlIsConfirmed ?? (input.isConfirmedAtl !== false),
    typicalSaleMedianEur: input.typicalSaleMedianEur ?? input.medianEur,
    otherFreshPricesEur: input.marketPricesEur ?? input.otherFreshPricesEur,
    independentMerchantCount: input.independentMerchantCount ?? ((input.sourceAgreementCount !== undefined && input.sourceAgreementCount >= 2 && input.isOfficialMerchant) ? 2 : undefined),
    ownHistoryEur: input.sourceHistoryEur,
    gameReleaseDate: input.gameReleaseDate,
    suspectedEditionInversion: input.suspectedEditionInversion,
    isDelisted: input.isDelisted,
    isUnreleased: input.isUnreleased
  };

  const prevPrice = input.previousPriceEur;
  if (prevPrice !== undefined && prevPrice > 0 && errorInput.priceEur >= prevPrice - 0.005) {
    return { riskScore: 0.0, riskLevel: 'SAFE' as const };
  }

  const errorEval = detectPricingError(errorInput);
  if (flags && errorEval.type) {
    flags.add(errorEval.type);
    if (errorEval.type === 'DECIMAL_SHIFT' && errorInput.priceEur <= 1.005) {
      flags.add('SUB_EURO_PREMIUM_GLITCH');
    }
  }

  const riskLevel = errorEval.isLikelyPricingError ? ('HIGH' as const) : (errorEval.confidence >= 0.15 ? ('LOW' as const) : ('SAFE' as const));
  return { riskScore: errorEval.confidence, riskLevel };
}

export function calculateRiskEvidenceConfidence(input: PriceMovementInput, flags?: Set<any>) {
  let score = 0.50;
  if (input.sourceAgreementCount !== undefined && input.sourceAgreementCount >= 2) score += 0.25;
  if (input.marketPricesEur && input.marketPricesEur.length >= 2) score += 0.15;
  if (input.basePriceEur) score += 0.10;
  return Math.max(0.10, Math.min(1.0, Math.round(score * 100) / 100));
}
