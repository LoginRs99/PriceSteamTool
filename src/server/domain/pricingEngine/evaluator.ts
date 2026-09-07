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

  // 4. Determine Anomaly Status (Price Increases can NEVER be anomalies)
  const isAnomaly = riskLevel === 'HIGH' && event !== 'PRICE_INCREASE';

  // 5. Generate Summary Text
  let summary = 'Standard Pricing';
  if (isAnomaly) {
    if (flags.has('SUB_EURO_PREMIUM_GLITCH')) {
      summary = '⚡ Sub-Euro Price Glitch (<€1.00)';
    } else if (flags.has('LONE_BOTTOM_OUTLIER')) {
      summary = '⚠️ Lone Outlier (>50% below other stores)';
    } else if (flags.has('EXTREME_MEDIAN_OUTLIER')) {
      summary = '⚠️ Extreme Disconnect from Market';
    } else if (flags.has('HISTORICAL_LOW_DISCREPANCY')) {
      summary = '⚡ Abnormal Drop Below Historical Record';
    } else if (flags.has('FRESH_RELEASE_UNEXPECTED_DROP')) {
      summary = '⚠️ Abnormal Drop on Recent Release';
    } else if (flags.has('SOURCE_OWN_HISTORY_BREAK')) {
      summary = '⚠️ Abnormal Crash vs Store History';
    } else {
      summary = '⚠️ Unverified Price Outlier';
    }
  } else {
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

    if (riskLevel === 'MEDIUM') {
      summary += ' • Caution Advised';
    }
  }

  return {
    event,
    riskLevel: isAnomaly ? riskLevel : (event === 'PRICE_INCREASE' ? 'SAFE' : riskLevel),
    riskScore: isAnomaly ? riskScore : (event === 'PRICE_INCREASE' ? 0.0 : riskScore),
    riskFlags: Array.from(flags),
    confidence,
    summary,
    isAnomaly
  };
}
