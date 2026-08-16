import type { PriceEventType, PriceRiskLevel } from '../../shared/types.js';

// ============================================================================
// Deal Score v2 — Tunable Constants (§9)
// ============================================================================
export const LOGISTIC_STEEPNESS = 1.1;       // §3 — higher = more aggressive separation around the median // TODO(calibrate)
export const BASE_SCORE_CEILING = 70;        // §3 — headroom left for rarity bonus (must sum to <=100 with ATL bonus) // TODO(calibrate)
export const IQR_TO_SIGMA = 1.349;           // §3 — standard constant (IQR-to-sigma conversion for normal distribution)
export const MIN_SCALE_PCT_OF_MEDIAN = 0.03; // §3 — floor for near-zero-volatility games
export const PRICE_MATCH_EPSILON_EUR = 0.05; // §4 — matches existing repo price match tolerance
export const ATL_BONUS = 30;                 // §4 — matches/undercuts confirmed ATL
export const LOW90D_BONUS = 18;              // §4 — new/matches 90-day low
export const LOW1Y_BONUS = 10;               // §4 — matches 1-year low
export const ATL_PROXIMITY_TAIL_MAX = 8;     // §4 — continuous tail reward for proximity to ATL
export const NO_HISTORY_FALLBACK_CAP = 25;   // §3 — fallback cap when no sale-price history exists

export interface DealScoreInput {
  priceEur: number;
  basePriceEur?: number;
  
  // Deal Score v2 Statistical Inputs (§2, §3, §4)
  typicalSaleMedianEur?: number | null;
  typicalSaleQ1Eur?: number;
  typicalSaleQ3Eur?: number;
  isLowSample?: boolean;
  low90dEur?: number | null;
  low1yEur?: number | null;
  allTimeLowEur?: number;

  // Data Quality & Safety Guard Inputs (§1, §6)
  riskLevel?: PriceRiskLevel;
  isAnomaly?: boolean;

  // Legacy compatibility fields (preserved for type safety)
  originalPriceEur?: number;
  discountPercent?: number;
  priceEvent?: PriceEventType;
  historicalLowEur?: number;
  isOfficialMerchant?: boolean;
  merchantTrustScore?: number;
  sourceAgreementCount?: number;
  riskScore?: number;
  evaluationConfidence?: number;
}

export type DealScoreTier = 'Exceptional' | 'Great' | 'Fair' | 'Weak';

export interface DealScoreResult {
  score: number; // 0 - 100
  tier: DealScoreTier;
  baseScore: number;
  rarityBonus: number;
  isLowSample: boolean;
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
}

/**
 * Classifies score into intuitive qualitative tiers
 */
export function getDealScoreTier(score: number): DealScoreTier {
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Great';
  if (score >= 40) return 'Fair';
  return 'Weak';
}

/**
 * Stage 1: Median-anchored, Volatility-normalized Base Score (§3)
 */
export function calculateBaseScore(
  priceEur: number,
  medianPriceEur: number | null | undefined,
  q1PriceEur?: number,
  q3PriceEur?: number,
  basePriceEur?: number
): { baseScore: number; zScore?: number; isLowSample: boolean } {
  if (medianPriceEur !== null && medianPriceEur !== undefined && medianPriceEur > 0) {
    const iqr = (q1PriceEur !== undefined && q3PriceEur !== undefined)
      ? Math.max(0, q3PriceEur - q1PriceEur)
      : 0;

    // Floor at 3% of median so near-zero IQR doesn't explode on tiny price moves
    const scale = Math.max(iqr / IQR_TO_SIGMA, medianPriceEur * MIN_SCALE_PCT_OF_MEDIAN);

    const z = (medianPriceEur - priceEur) / scale; // positive z = cheaper than typical sale price
    const zScore = Number(z.toFixed(3));

    // Logistic squash: z=0 -> 35 (dead center), asymptotic ceiling ~70 as z->+inf, ~0 as z->-inf
    const baseScore = BASE_SCORE_CEILING / (1 + Math.exp(-LOGISTIC_STEEPNESS * z));

    return {
      baseScore,
      zScore,
      isLowSample: false
    };
  }

  // Fallback when there's no sale-price history yet (median === null)
  const discountPct = basePriceEur && basePriceEur > 0 && priceEur < basePriceEur
    ? ((basePriceEur - priceEur) / basePriceEur) * 100
    : 0;
  const baseScore = Math.min(NO_HISTORY_FALLBACK_CAP, discountPct * 0.3); // deliberately capped low

  return {
    baseScore,
    zScore: undefined,
    isLowSample: true
  };
}

/**
 * Stage 2: Single-Ladder Rarity Bonus (§4)
 * Evaluates the highest qualifying period-low tier (ATL -> 90d -> 1y -> Proximity tail)
 */
export function calculateRarityBonus(
  priceEur: number,
  allTimeLowEur?: number,
  low90dEur?: number | null,
  low1yEur?: number | null
): number {
  const EPS = PRICE_MATCH_EPSILON_EUR;
  const atl = allTimeLowEur ?? 0;

  if (atl > 0 && priceEur <= atl + EPS) {
    return ATL_BONUS; // matches/undercuts confirmed ATL (30)
  }
  
  if (low90dEur !== null && low90dEur !== undefined && low90dEur > 0 && priceEur <= low90dEur + EPS) {
    return LOW90D_BONUS; // new/matches 90-day low (18)
  }
  
  if (low1yEur !== null && low1yEur !== undefined && low1yEur > 0 && priceEur <= low1yEur + EPS) {
    return LOW1Y_BONUS; // matches 1-year low (10)
  }
  
  if (atl > 0 && priceEur > atl + EPS) {
    // Continuous tail: reward proximity to ATL even when not reached
    const proximity = Math.max(0, Math.min(1, 1 - (priceEur - atl) / (atl * 0.5)));
    return Math.round(ATL_PROXIMITY_TAIL_MAX * proximity);
  }

  return 0;
}

/**
 * Deterministic Deal Score v2 Calculation (0 - 100)
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  const priceEur = input.priceEur;
  const median = input.typicalSaleMedianEur;
  const atl = input.allTimeLowEur ?? input.historicalLowEur;

  // 1. Stage 1: Base Score
  const { baseScore, zScore, isLowSample } = calculateBaseScore(
    priceEur,
    median,
    input.typicalSaleQ1Eur,
    input.typicalSaleQ3Eur,
    input.basePriceEur ?? input.originalPriceEur
  );

  // 2. Stage 2: Rarity Bonus
  const rarityBonus = calculateRarityBonus(
    priceEur,
    atl,
    input.low90dEur,
    input.low1yEur
  );

  // 3. Stage 3: Combine
  const rawBeforeClamp = baseScore + rarityBonus;
  let score = Math.round(Math.max(0, Math.min(100, rawBeforeClamp)));

  // 4. Safety Guard (§6): HIGH risk or anomaly is capped at 35
  if (input.isAnomaly === true || input.riskLevel === 'HIGH') {
    score = Math.min(score, 35);
  }

  const tier = getDealScoreTier(score);

  return {
    score,
    tier,
    baseScore: Number(baseScore.toFixed(2)),
    rarityBonus,
    isLowSample: Boolean(isLowSample || input.isLowSample),
    zScore,
    components: {
      subtotal: score,
      confidenceMultiplier: 1.0,
      riskPenalty: 0,
      rawScore: Number(rawBeforeClamp.toFixed(2))
    }
  };
}

// Backward-compatibility stubs for legacy test callers
export function calculateDiscountScore(discountPercent: number): number {
  return Math.min(45, discountPercent * 0.5);
}
export function calculateHistoricalScore(): number {
  return 0;
}
export function calculateTrustScore(): number {
  return 20;
}
export function getRiskPenalty(): number {
  return 0;
}
