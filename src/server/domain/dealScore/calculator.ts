import type { DealScoreInput, DealScoreResult, DealVerdict } from './types.js';
import {
  W_ATL,
  W_DISCOUNT,
  W_HISTORY,
  W_MARKET,
  MAX_REALISTIC_DISCOUNT_PCT,
  FAKE_BASELINE_RATIO,
  SINGLE_OFFER_MARKET_SCORE,
  NO_HISTORY_CAP,
  PROVISIONAL_CAP,
  PROVISIONAL_DEEP_CAP,
  STALE_CAP,
  DATA_SUFFICIENCY_MIN_SAMPLES
} from './types.js';
import { getDealScoreTier } from './tiers.js';
import { calculateDataConfidence } from './confidence.js';

function clamp(val: number, min: number, max: number): number {
  if (isNaN(val)) return min;
  return Math.min(Math.max(val, min), max);
}

/**
 * DealScore v2 Calculator
 * Trust-free scoring using 4 mathematical pillars:
 * 1. S_atl: Proximity to All-Time Low (0 - 40)
 * 2. S_disc: Discount Depth vs Reliable Anchor (0 - 30)
 * 3. S_hist: Historical Sale Distribution Position (0 - 20)
 * 4. S_mkt: Cross-Market Competitiveness (0 - 10)
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  // Defensive: if pricing error, callers skip scoring -> return score 0, verdict 'WAIT'
  if (input.isPricingError) {
    return {
      score: 0,
      tier: 'Weak',
      verdict: 'WAIT',
      baseScore: 0,
      rarityBonus: 0,
      confidenceScore: 0,
      confidenceTier: 'Low',
      isLowSample: true,
      isProvisional: false,
      components: {
        atlProximity: 0,
        discountDepth: 0,
        historicalValue: 0,
        marketPosition: 0,
        subtotal: 0,
        rawScore: 0
      },
      explanation: {
        medianSavingEur: 0,
        atlDistanceEur: 0,
        confidenceFactors: {}
      }
    };
  }

  const price = Math.max(0, input.priceEur);
  const anchor = input.basePriceEur ?? input.originalPriceEur;
  const atl = input.allTimeLowEur ?? input.historicalLowEur ?? input.low1yEur;
  const med = input.typicalSaleMedianEur;

  // Pillar 1: S_atl (ATL Proximity: 0 - 40)
  let S_atl = 0;
  if (atl !== undefined && atl !== null) {
    const bandTop = anchor ?? (atl * 2);
    const band = Math.max(bandTop - atl, 0.01);
    S_atl = W_ATL * (1 - clamp((price - atl) / band, 0, 1));
    if (input.isConfirmedAtl === false || input.isSingleSourceLow === true) {
      S_atl *= 0.5;
    }
  }

  // Pillar 2: S_disc (Discount Depth: 0 - 30)
  let discountPct = 0;
  let S_disc = 0;
  if (anchor !== undefined && anchor !== null && anchor > 0) {
    if (input.basePriceEur !== undefined && input.originalPriceEur !== undefined && input.originalPriceEur > FAKE_BASELINE_RATIO * input.basePriceEur) {
      // Fake baseline: ignore claimed original
      discountPct = 0;
      S_disc = 0;
    } else {
      discountPct = clamp((anchor - price) / anchor, 0, 1) * 100;
      S_disc = W_DISCOUNT * clamp(discountPct / MAX_REALISTIC_DISCOUNT_PCT, 0, 1);
    }
  }

  // Pillar 3: S_hist (Historical Sale Distribution: 0 - 20)
  let S_hist = 0;
  if (med !== undefined && med !== null) {
    if (price > med) {
      S_hist = 0;
    } else {
      const atlRef = atl ?? 0;
      const band = Math.max(med - atlRef, 0.01);
      S_hist = W_HISTORY * (1 - clamp((price - atlRef) / band, 0, 1));
    }
  }

  // Pillar 4: S_mkt (Cross-Market Position: 0 - 10)
  const offersCount = input.offersCount ?? (input.otherOfferCount !== undefined ? input.otherOfferCount + 1 : 1);
  let S_mkt = SINGLE_OFFER_MARKET_SCORE;
  if (offersCount > 1) {
    const mktMin = input.minOfferEur ?? input.marketMinPriceEur ?? price;
    const mktMax = input.maxOfferEur ?? price;
    if (mktMax === mktMin) {
      S_mkt = SINGLE_OFFER_MARKET_SCORE;
    } else {
      S_mkt = W_MARKET * (1 - clamp((price - mktMin) / (mktMax - mktMin), 0, 1));
    }
  }

  // Raw score: S_raw = S_atl + S_disc + S_hist + S_mkt
  const S_raw = S_atl + S_disc + S_hist + S_mkt;
  let score = S_raw;

  // History presence and sample count
  const hasSomeHistory = (atl !== undefined && atl !== null) || (med !== undefined && med !== null) || ((input.sampleCount ?? 0) > 0);
  const sampleCount = input.sampleCount !== undefined ? input.sampleCount : (hasSomeHistory ? 5 : 0);
  const isProvisional = !hasSomeHistory || sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES;

  // Caps applied in sequence:
  // 1. Data sufficiency: if sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES (or no history at all):
  //    if discountPct >= 60 → PROVISIONAL_DEEP_CAP (80),
  //    else if has some history → PROVISIONAL_CAP (65),
  //    else if no history at all → NO_HISTORY_CAP (40).
  if (isProvisional) {
    if (discountPct >= 60) {
      score = Math.min(score, PROVISIONAL_DEEP_CAP);
    } else if (hasSomeHistory) {
      score = Math.min(score, PROVISIONAL_CAP);
    } else {
      score = Math.min(score, NO_HISTORY_CAP);
    }
  }

  // 2. Stale history: if daysSinceLastSample > 90 → score = min(score, STALE_CAP)
  const isStale = Boolean(input.isStalePrice || (input.daysSinceLastSample !== undefined && input.daysSinceLastSample > 90));
  if (isStale) {
    score = Math.min(score, STALE_CAP);
  }

  const finalScore = Math.round(clamp(score, 0, 100));

  // Verdict / tier mapping: 0-39 WAIT, 40-59 FAIR, 60-79 GOOD, 80-100 BUY
  let verdict: DealVerdict;
  if (anchor !== undefined && anchor > 0 && price > anchor + 0.005) {
    verdict = 'OVERPRICED';
  } else if (finalScore >= 80) {
    verdict = 'INSTANT_BUY';
  } else if (finalScore >= 60) {
    verdict = 'GREAT_DEAL';
  } else if (finalScore >= 40) {
    verdict = 'FAIR_DEAL';
  } else {
    verdict = 'WAIT';
  }

  const effectiveSampleCount = input.sampleCount ?? (hasSomeHistory ? 5 : 0);
  const confidenceData = calculateDataConfidence({
    sampleCount: effectiveSampleCount,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    sourceCount: input.sourceCount ?? 1
  });

  const tier = getDealScoreTier(finalScore);

  const medianSavingEur = med !== undefined && med !== null
    ? Number((med - price).toFixed(2))
    : 0;

  const atlDistanceEur = atl !== undefined && atl !== null
    ? Number((price - atl).toFixed(2))
    : 0;

  return {
    score: finalScore,
    tier,
    verdict,
    baseScore: Number(S_disc.toFixed(2)),
    rarityBonus: Number(S_atl.toFixed(2)),
    confidenceScore: confidenceData.confidence,
    confidenceTier: confidenceData.tier,
    isLowSample: confidenceData.confidence < 40,
    isProvisional,
    components: {
      atlProximity: Number(S_atl.toFixed(2)),
      discountDepth: Number(S_disc.toFixed(2)),
      historicalValue: Number(S_hist.toFixed(2)),
      marketPosition: Number(S_mkt.toFixed(2)),
      subtotal: finalScore,
      rawScore: Number(S_raw.toFixed(2))
    },
    explanation: {
      medianSavingEur,
      atlDistanceEur,
      confidenceFactors: confidenceData.factors
    }
  };
}
