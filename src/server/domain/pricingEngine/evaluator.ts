import type { PriceEvaluation, PriceRiskFlag } from '../../../shared/types.js';
import type { PriceEvaluationInput } from './types.js';
import { detectPriceEvent } from './priceEvents.js';
import { calculateRiskEvidenceConfidence, calculatePriceRisk } from './riskEvaluator.js';

/**
 * Primary 2D Pricing Engine Evaluator.
 * Orchestrates Event Detection, Risk Scoring, and Confidence Evaluation.
 */
export function evaluatePriceMovement(input: PriceEvaluationInput): PriceEvaluation {
  const flags = new Set<PriceRiskFlag>();

  // 1. Calculate Confidence (data richness and freshness)
  const confidence = calculateRiskEvidenceConfidence(input, flags);

  // 2. Calculate Risk
  const { riskScore, riskLevel } = calculatePriceRisk(input, flags);

  // 3. Detect Market Event
  const event = detectPriceEvent(input, confidence, riskLevel);

  // 4. Generate Summary Text
  let summary = 'Standard Pricing';
  if (event === 'NEW_HISTORICAL_LOW') {
    summary = '🏆 Confirmed All-Time Low';
  } else if (event === 'SUSPECTED_HISTORICAL_LOW') {
    summary = '⚡ Unconfirmed Record Drop';
  } else if (event === 'EXTREME_DROP') {
    summary = '🔥 Extreme Price Drop';
  } else if (event === 'MAJOR_DROP') {
    summary = '🔥 Major Price Drop';
  } else if (event === 'SIGNIFICANT_DROP') {
    summary = '✨ Significant Discount';
  } else if (event === 'STANDARD_SALE') {
    summary = '🏷️ On Sale';
  } else if (event === 'PRICE_INCREASE') {
    summary = '📈 Price Increased';
  }

  if (riskLevel === 'HIGH') {
    summary += ' • ⚠️ High Risk Anomaly';
  } else if (riskLevel === 'MEDIUM') {
    summary += ' • Caution Advised';
  }

  return {
    event,
    riskLevel,
    riskScore,
    riskFlags: Array.from(flags),
    confidence,
    summary,
    isAnomaly: riskLevel === 'HIGH'
  };
}
