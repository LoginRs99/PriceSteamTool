import type { DealScoreInput, DealScoreResult } from './types.js';
import { 
  NO_HISTORY_FALLBACK_CAP, 
  DATA_SUFFICIENCY_MIN_SAMPLES, 
  PROVISIONAL_SCORE_CAP,
  PROVISIONAL_DEEP_DISCOUNT_CAP,
  SAVINGS_TIER_HIGH_EUR,
  SAVINGS_TIER_MASSIVE_EUR
} from './types.js';
import { getDealScoreTier } from './tiers.js';
import { calculateBaseScore } from './baseScore.js';
import { calculateRecordBonus } from './recordBonus.js';
import { calculateDataConfidence } from './confidence.js';

/**
 * Deterministic Deal Score v2.3 Calculation (0 - 100)
 * Pure mathematical price scoring with explicit Data Sufficiency Guard.
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  const priceEur = Math.max(0, input.priceEur);
  const median = input.typicalSaleMedianEur;
  const atl = input.allTimeLowEur ?? input.historicalLowEur ?? input.low1yEur;

  // 1. Stage 1: Base Score (0 - 75)
  const { baseScore, zScore, effectiveSigma } = calculateBaseScore(
    priceEur,
    median,
    input.typicalSaleQ1Eur,
    input.typicalSaleQ3Eur
  );

  // 2. Stage 2: Record Bonus (0 - 35)
  let { recordBonus, atlDistanceEur } = calculateRecordBonus(
    priceEur,
    median,
    atl
  );

  // If ATL is unconfirmed (single-source keyshop outlier without corroboration), halve the record bonus
  if (input.isConfirmedAtl === false || input.isSingleSourceLow === true) {
    recordBonus = Number((recordBonus * 0.5).toFixed(2));
  }

  // 3. Stage 3: Sum & Absolute Savings Booster
  let rawScore = baseScore + recordBonus;

  // Absolute Savings Booster:
  // When buying expensive AA/AAA titles (50€ - 90€+), saving €25 or €40+ is a massive real-world saving
  // that deserves a score boost beyond pure relative percentage, provided the price is genuinely below typical median.
  const msrp = input.basePriceEur ?? input.originalPriceEur ?? median ?? 0;
  const isBelowTypicalMedian = median && priceEur < median - 0.01;
  const absoluteSavingEur = msrp > priceEur ? (msrp - priceEur) : 0;
  let savingsBoost = 0;
  if (isBelowTypicalMedian) {
    if (absoluteSavingEur >= SAVINGS_TIER_MASSIVE_EUR) {
      savingsBoost = 10;
    } else if (absoluteSavingEur >= SAVINGS_TIER_HIGH_EUR) {
      savingsBoost = 5;
    }
  }
  rawScore += savingsBoost;

  let riskPenalty = 0;

  // Fallback for 0-history items (e.g. brand new unreleased games with no median)
  const isNoHistory = (median === null || median === undefined || median <= 0);
  if (isNoHistory) {
    const basePrice = input.basePriceEur ?? input.originalPriceEur;
    const discountPct = (basePrice && basePrice > 0 && priceEur < basePrice)
      ? ((basePrice - priceEur) / basePrice) * 100
      : 0;
    rawScore = Math.min(NO_HISTORY_FALLBACK_CAP, discountPct * 0.3);
  } else {
    // Pricing error penalty if not skipped upstream
    if (input.isPricingError) {
      riskPenalty = 25;
      rawScore = Math.max(0, rawScore - riskPenalty);
    }
  }

  let finalScore = Math.round(Math.max(0, Math.min(100, rawScore)));

  // 4. Data Sufficiency Guard:
  // If historical sample is very sparse (N = 1 or 2), the statistical distribution is not yet established.
  // Standard cap is PROVISIONAL_SCORE_CAP (65 - Good).
  // Dynamic deep discount expansion: when msrp > 0 && priceEur <= msrp * 0.40 (>=60% off),
  // cap at PROVISIONAL_DEEP_DISCOUNT_CAP (80) instead of 65.
  const sampleCount = input.sampleCount ?? (isNoHistory ? 0 : 5);
  const isProvisional = !isNoHistory && sampleCount > 0 && sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES;
  if (isProvisional) {
    const isDeepDiscount = msrp > 0 && priceEur <= msrp * 0.40;
    const cap = isDeepDiscount ? PROVISIONAL_DEEP_DISCOUNT_CAP : PROVISIONAL_SCORE_CAP;
    finalScore = Math.min(finalScore, cap);
  }

  const tier = getDealScoreTier(finalScore);

  // 5. Data Confidence (Strictly independent)
  const confidenceData = calculateDataConfidence({
    sampleCount,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    sourceCount: input.sourceCount ?? 1
  });

  const verdict = 
    finalScore >= 85 ? 'INSTANT_BUY' :
    finalScore >= 70 ? 'GREAT_DEAL' :
    finalScore >= 50 ? 'FAIR_DEAL' :
    finalScore >= 30 ? 'WAIT' : 'OVERPRICED';

  return {
    score: finalScore,
    tier,
    verdict,
    baseScore,
    rarityBonus: recordBonus,
    confidenceScore: confidenceData.confidence,
    confidenceTier: confidenceData.tier,
    isLowSample: confidenceData.confidence < 40,
    isProvisional,
    components: {
      atlProximity: recordBonus,
      discountDepth: baseScore,
      historicalValue: savingsBoost,
      marketPosition: 0,
      subtotal: finalScore,
      rawScore: Number(rawScore.toFixed(2))
    },
    explanation: {
      medianSavingEur: median ? Number((median - priceEur).toFixed(2)) : 0,
      atlDistanceEur: atlDistanceEur ?? 0,
      confidenceFactors: confidenceData.factors
    }
  };
}
