import { evaluatePriceMovement, type PriceEvaluationInput } from './pricingEngine.js';
import type { Anomaly, PriceEvaluation } from '../../shared/types.js';

export interface AnomalyEvaluationInput {
  priceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;
  historicalLowEur?: number;
  previousPriceEur?: number;
  isOfficial: boolean;
  merchantTrustScore?: number;
  otherPrices?: number[];
  sourceAgreementCount?: number;
  gameReleaseDate?: string;
  isStaleObservation?: boolean;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  type?: Anomaly['anomalyType'];
  reason?: string;
  evaluation?: PriceEvaluation;
}

/**
 * Backwards compatible adapter bridging to the comprehensive 2D Pricing Engine.
 */
export function evaluateOfferAnomaly(input: AnomalyEvaluationInput): AnomalyResult {
  const evalInput: PriceEvaluationInput = {
    currentPriceEur: input.priceEur,
    originalPriceEur: input.originalPriceEur,
    basePriceEur: input.basePriceEur,
    historicalLowEur: input.historicalLowEur,
    previousPriceEur: input.previousPriceEur,
    marketPricesEur: input.otherPrices || [],
    sourceAgreementCount: input.sourceAgreementCount || 1,
    isOfficialMerchant: input.isOfficial,
    merchantTrustScore: input.merchantTrustScore,
    gameReleaseDate: input.gameReleaseDate,
    isStaleObservation: input.isStaleObservation
  };

  const evalResult = evaluatePriceMovement(evalInput);

  let type: string = 'STANDARD';
  let reason = evalResult.summary;

  if (evalResult.riskFlags.includes('SUB_EURO_PREMIUM_GLITCH')) {
    type = 'EXTREME_DISCOUNT';
    reason = `Suspiciously low price (€${input.priceEur.toFixed(2)}) on a €${(input.basePriceEur || 0).toFixed(2)} MSRP title from an unverified merchant`;
  } else if (evalResult.riskFlags.includes('EXTREME_MEDIAN_OUTLIER')) {
    type = 'UNVERIFIED_MERCHANT_DISCREPANCY';
    reason = `Price (€${input.priceEur.toFixed(2)}) is over 75% below the store median`;
  } else if (evalResult.riskFlags.includes('HISTORICAL_LOW_DISCREPANCY')) {
    type = 'SUDDEN_DROP';
    reason = `Price (€${input.priceEur.toFixed(2)}) is far below the all-time historical low`;
  }

  return {
    isAnomaly: evalResult.isAnomaly,
    score: evalResult.riskScore,
    type,
    reason,
    evaluation: evalResult
  };
}

export { evaluatePriceMovement };
