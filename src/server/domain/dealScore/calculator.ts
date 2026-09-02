import type { DealScoreInput, DealScoreResult } from './types.js';
import { NO_HISTORY_FALLBACK_CAP, DATA_SUFFICIENCY_MIN_SAMPLES, PROVISIONAL_SCORE_CAP } from './types.js';
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

  // 3. Stage 3: Sum & Clamp
  let rawScore = baseScore + recordBonus;

  // Fallback for 0-history items (e.g. brand new unreleased games with no median)
  const isNoHistory = (median === null || median === undefined || median <= 0);
  if (isNoHistory) {
    const basePrice = input.basePriceEur ?? input.originalPriceEur;
    const discountPct = (basePrice && basePrice > 0 && priceEur < basePrice)
      ? ((basePrice - priceEur) / basePrice) * 100
      : 0;
    rawScore = Math.min(NO_HISTORY_FALLBACK_CAP, discountPct * 0.3);
  }

  let finalScore = Math.round(Math.max(0, Math.min(100, rawScore)));

  // 4. Data Sufficiency Guard:
  // If historical sample is very sparse (N = 1 or 2), the statistical distribution is not yet established.
  // We cap the score at PROVISIONAL_SCORE_CAP (65 - Good) so it cannot claim "Exceptional/Historical Low Record (85-100)"
  // without at least 3 historical data points.
  const sampleCount = input.sampleCount ?? (isNoHistory ? 0 : 5);
  const isProvisional = !isNoHistory && sampleCount > 0 && sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES;
  if (isProvisional) {
    finalScore = Math.min(finalScore, PROVISIONAL_SCORE_CAP);
  }

  const tier = getDealScoreTier(finalScore);

  // 5. Data Confidence (Strictly independent)
  const confidenceData = calculateDataConfidence({
    sampleCount,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    sourceCount: input.sourceCount ?? 1
  });

  return {
    score: finalScore,
    tier,
    baseScore,
    rarityBonus: recordBonus,
    confidenceScore: confidenceData.confidence,
    confidenceTier: confidenceData.tier,
    isLowSample: confidenceData.confidence < 40,
    isProvisional,
    zScore,
    components: {
      subtotal: finalScore,
      confidenceMultiplier: 1.0,
      riskPenalty: 0,
      rawScore: Number(rawScore.toFixed(2))
    },
    explanation: {
      effectiveSigma,
      medianSavingEur: median ? Number((median - priceEur).toFixed(2)) : 0,
      atlDistanceEur: atlDistanceEur ?? 0,
      confidenceFactors: confidenceData.factors
    }
  };
}
