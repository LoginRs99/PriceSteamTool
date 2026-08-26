import type { PriceEventType, PriceRiskLevel, DealScoreTier, ConfidenceTier } from '../../shared/types.js';

// ============================================================================
// Deal Score v2.3 — Tunable Constants (§0, §1, §2, §3)
// ============================================================================
export const LOGISTIC_STEEPNESS = 1.2;             // Sharp separation around the median
export const BASE_SCORE_CEILING = 65;              // Headroom for base median-relative score (0 - 65)
export const RECORD_BONUS_MAX = 35;                // Max bonus for breaking historical low (0 - 35)
export const RECORD_BONUS_AT_ATL = 20;             // Base record bonus for matching existing ATL (0 - 20)
export const UNDERCUT_FULL_DEPTH_RATIO = 0.20;     // 20% undercut below old ATL earns full extra undercut bonus (+15)
export const IQR_TO_SIGMA = 1.349;                 // Standard normal IQR-to-sigma conversion
export const MIN_SCALE_PCT_OF_MEDIAN = 0.08;       // 8% floor for zero/low-volatility games
export const ABSOLUTE_MIN_SCALE_EUR = 0.30;        // 0.30 € absolute floor for sub-euro/cheap games
export const NO_HISTORY_FALLBACK_CAP = 25;         // Max score when zero historical data exists
export const ATL_FULL_DEPTH_RATIO = 0.35;          // ATL depth below median that earns 100% of base record bonus
export const DATA_SUFFICIENCY_MIN_SAMPLES = 3;     // Min historical observations to establish full distribution
export const PROVISIONAL_SCORE_CAP = 65;           // Max score when N = 1 or 2 (prevents false Exceptional on sparse data)

export interface DealScoreInput {
  priceEur: number;
  basePriceEur?: number;
  
  // Statistical Inputs (180d / 365d / All-Time historical observations)
  typicalSaleMedianEur?: number | null;
  typicalSaleQ1Eur?: number;
  typicalSaleQ3Eur?: number;
  low90dEur?: number | null;
  low1yEur?: number | null;
  allTimeLowEur?: number | null;
  historicalLowEur?: number | null;
  
  // Confidence Inputs
  sampleCount?: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  sourceCount?: number;
  isOfficialSource?: boolean;
  
  // Data Quality & Anomaly Guards (Passed for metadata / UI flags)
  isAnomaly?: boolean;
  riskLevel?: PriceRiskLevel;

  // Legacy compatibility fields (preserved for type safety)
  isLowSample?: boolean;
  isConfirmedAtl?: boolean;
  isSingleSourceLow?: boolean;
  originalPriceEur?: number;
  discountPercent?: number;
  priceEvent?: PriceEventType;
  isOfficialMerchant?: boolean;
  merchantTrustScore?: number;
  sourceAgreementCount?: number;
  riskScore?: number;
  evaluationConfidence?: number;
}

export interface DealScoreResult {
  score: number; // 0 - 100
  tier: DealScoreTier;
  baseScore: number;
  rarityBonus: number;
  confidenceScore: number; // 0 - 100 (%)
  confidenceTier: ConfidenceTier;
  isLowSample: boolean;
  isProvisional?: boolean;
  zScore?: number;
  components?: {
    discountScore?: number;
    historicalScore?: number;
    trustScore?: number;
    subtotal: number;
    confidenceMultiplier: number;
    riskPenalty: number;
    rawScore: number;
  };
  explanation?: {
    effectiveSigma: number;
    medianSavingEur: number;
    atlDistanceEur: number;
    confidenceFactors: Record<string, number>;
  };
}

/**
 * Classifies Deal Score into qualitative tiers
 */
export function getDealScoreTier(score: number): DealScoreTier {
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Great';
  if (score >= 55) return 'Good';
  if (score >= 35) return 'Fair';
  return 'Weak';
}

/**
 * Classifies Confidence into qualitative tiers
 */
export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 80) return 'High';
  if (confidence >= 60) return 'Medium';
  if (confidence >= 40) return 'Moderate';
  return 'Low';
}

/**
 * Stage 1: Median-anchored, Volatility-normalized Base Score (0 - 65)
 * Symmetrical logistic curve: z = 0 -> 32.5 (dead-center Fair)
 */
export function calculateBaseScore(
  priceEur: number,
  medianPriceEur: number | null | undefined,
  q1PriceEur?: number,
  q3PriceEur?: number
): { baseScore: number; zScore: number; effectiveSigma: number } {
  if (medianPriceEur === null || medianPriceEur === undefined || medianPriceEur <= 0) {
    return {
      baseScore: 0,
      zScore: 0,
      effectiveSigma: ABSOLUTE_MIN_SCALE_EUR
    };
  }

  const iqr = (q1PriceEur !== undefined && q3PriceEur !== undefined)
    ? Math.max(0, q3PriceEur - q1PriceEur)
    : 0;

  // Adaptive scale floor: max(IQR / 1.349, 8% of median, 0.30 €)
  const effectiveSigma = Math.max(
    iqr / IQR_TO_SIGMA,
    medianPriceEur * MIN_SCALE_PCT_OF_MEDIAN,
    ABSOLUTE_MIN_SCALE_EUR
  );

  const z = (medianPriceEur - priceEur) / effectiveSigma;
  const zScore = Number(z.toFixed(3));

  // Symmetrical Logistic Curve: z=0 -> 32.5 (Base Score Ceiling = 65)
  const baseScore = BASE_SCORE_CEILING / (1 + Math.exp(-LOGISTIC_STEEPNESS * z));

  return {
    baseScore: Number(baseScore.toFixed(2)),
    zScore,
    effectiveSigma: Number(effectiveSigma.toFixed(3))
  };
}

/**
 * Stage 2: Continuous Relative Record Bonus (0 - 35)
 * Scaled by ATL depth below median & progressive bonus for deeper undercuts below old ATL.
 */
export function calculateRecordBonus(
  priceEur: number,
  medianPriceEur?: number | null,
  allTimeLowEur?: number | null
): { recordBonus: number; atlDistanceEur?: number } {
  if (allTimeLowEur === undefined || allTimeLowEur === null || allTimeLowEur < 0) {
    return { recordBonus: 0 };
  }

  const atl = allTimeLowEur;
  const median = (medianPriceEur && medianPriceEur > 0) ? medianPriceEur : atl;

  // 1. Calculate ATL depth below median: how significant is this ATL?
  const atlDepthRatio = median > 0 ? Math.max(0, (median - atl) / median) : 0;
  // If ATL is very shallow (< 1% below median), base bonus is appropriately scaled
  const maxBaseBonusForDepth = RECORD_BONUS_AT_ATL * Math.min(1.0, atlDepthRatio / ATL_FULL_DEPTH_RATIO);

  // 2. Case A: Price is strictly below ATL (New Record / Undercutting previous ATL)
  if (priceEur < atl) {
    const baseBonus = maxBaseBonusForDepth;
    const undercutRatio = atl > 0 ? (atl - priceEur) / atl : 0;
    const maxExtra = (RECORD_BONUS_MAX - RECORD_BONUS_AT_ATL) * Math.min(1.0, atlDepthRatio / ATL_FULL_DEPTH_RATIO);
    const extraUndercutBonus = maxExtra * Math.min(1.0, undercutRatio / UNDERCUT_FULL_DEPTH_RATIO);
    
    const recordBonus = baseBonus + extraUndercutBonus;
    return {
      recordBonus: Number(recordBonus.toFixed(2)),
      atlDistanceEur: Number((priceEur - atl).toFixed(2))
    };
  }

  // 3. Case B: Price exactly matches ATL (Reaching existing record)
  if (priceEur === atl) {
    return {
      recordBonus: Number(maxBaseBonusForDepth.toFixed(2)),
      atlDistanceEur: 0
    };
  }

  // 4. Case C: Approaching ATL from above: smooth quadratic decay to 0 at median
  const span = Math.max(0.30, median - atl);
  const normalizedDistance = (priceEur - atl) / span;

  if (normalizedDistance >= 1.0) {
    return {
      recordBonus: 0,
      atlDistanceEur: Number((priceEur - atl).toFixed(2))
    };
  }

  const proximityRatio = Math.max(0, 1 - normalizedDistance);
  const recordBonus = maxBaseBonusForDepth * Math.pow(proximityRatio, 2);

  return {
    recordBonus: Number(recordBonus.toFixed(2)),
    atlDistanceEur: Number((priceEur - atl).toFixed(2))
  };
}

// Backward-compatible alias for existing callers
export function calculateRarityBonus(
  priceEur: number,
  allTimeLowEur?: number | null,
  low90dEur?: number | null,
  low1yEur?: number | null,
  isLowSample?: boolean,
  isConfirmedAtl?: boolean
): number {
  const atl = low1yEur ?? allTimeLowEur;
  const result = calculateRecordBonus(priceEur, null, atl);
  let bonus = result.recordBonus;
  if (isConfirmedAtl === false) {
    bonus = bonus * 0.5;
  }
  return Math.round(bonus);
}

/**
 * User-facing Multi-Factor Data Confidence Calculation (0 - 100%).
 * This is the primary user-facing Confidence shown throughout the UI and Discord alerts.
 * (For internal pricing risk/anomaly evidence confidence, see pricingEngine.ts:calculateRiskEvidenceConfidence).
 */
export function calculateDataConfidence(input: {
  sampleCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  sourceCount?: number;
  isOfficialSource?: boolean;
}): { confidence: number; tier: ConfidenceTier; factors: Record<string, number> } {
  const n = Math.max(0, input.sampleCount || 0);

  // 1. Sample factor: sqrt(N / 16), capped at 1.0
  const cSample = Math.min(1.0, Math.sqrt(n / 16));

  // 2. Coverage factor: duration in days between first and last observation
  let daysSpan = 0;
  if (input.firstObservedAt && input.lastObservedAt) {
    const tFirst = new Date(input.firstObservedAt).getTime();
    const tLast = new Date(input.lastObservedAt).getTime();
    if (!isNaN(tFirst) && !isNaN(tLast) && tLast >= tFirst) {
      daysSpan = (tLast - tFirst) / (1000 * 3600 * 24);
    }
  }

  let cCoverage = 0.45;
  if (daysSpan >= 180) cCoverage = 1.0;
  else if (daysSpan >= 60) cCoverage = 0.85;
  else if (daysSpan >= 14) cCoverage = 0.65;
  else if (n <= 1) cCoverage = 0.40;

  // 3. Source independence factor
  const sources = Math.max(1, input.sourceCount || 1);
  let cSources = 0.70;
  if (sources >= 2) cSources = 1.0;
  else if (input.isOfficialSource) cSources = 0.85;

  // 4. Freshness factor
  let cFreshness = 0.85;
  if (input.lastObservedAt) {
    const tLast = new Date(input.lastObservedAt).getTime();
    const hoursSince = (Date.now() - tLast) / (1000 * 3600);
    if (!isNaN(hoursSince)) {
      if (hoursSince <= 36) cFreshness = 1.0;
      else if (hoursSince <= 168) cFreshness = 0.85;
      else cFreshness = 0.55;
    }
  }

  // Combined product
  const rawConfidence = cSample * cCoverage * cSources * cFreshness * 100;
  const confidence = Math.round(Math.max(0, Math.min(100, rawConfidence)));
  const tier = getConfidenceTier(confidence);

  return {
    confidence,
    tier,
    factors: {
      sample: Number(cSample.toFixed(2)),
      coverage: Number(cCoverage.toFixed(2)),
      sources: Number(cSources.toFixed(2)),
      freshness: Number(cFreshness.toFixed(2))
    }
  };
}

/**
 * Deterministic Deal Score v2.2 Calculation (0 - 100)
 * Pure mathematical price scoring with explicit Data Sufficiency Guard.
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  const priceEur = Math.max(0, input.priceEur);
  const median = input.typicalSaleMedianEur;
  const atl = input.low1yEur ?? input.allTimeLowEur ?? input.historicalLowEur;

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
    sourceCount: input.sourceCount ?? 1,
    isOfficialSource: input.isOfficialSource ?? true
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
