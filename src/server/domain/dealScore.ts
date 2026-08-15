import type { PriceEventType, PriceRiskLevel } from '../../shared/types.js';

export interface DealScoreInput {
  priceEur: number;
  basePriceEur?: number;
  originalPriceEur?: number;
  discountPercent?: number;
  priceEvent?: PriceEventType;
  historicalLowEur?: number;
  isOfficialMerchant?: boolean;
  merchantTrustScore?: number;
  sourceAgreementCount?: number;
  riskLevel?: PriceRiskLevel;
  riskScore?: number;
  evaluationConfidence?: number;
  isAnomaly?: boolean;
}

export type DealScoreTier = 'Exceptional' | 'Great' | 'Fair' | 'Weak';

export interface DealScoreResult {
  score: number; // 0 - 100
  tier: DealScoreTier;
  components: {
    discountScore: number;     // 0 - 45
    historicalScore: number;   // 0 - 35
    trustScore: number;        // 0 - 20
    subtotal: number;          // 0 - 100
    confidenceMultiplier: number; // 0.70 - 1.00
    riskPenalty: number;       // 0, 5, 25, 60
    rawScore: number;
  };
}

/**
 * Pillar 1: Discount Depth (max 45 points)
 */
export function calculateDiscountScore(discountPercent: number): number {
  if (!discountPercent || discountPercent <= 0) return 0;
  if (discountPercent <= 20) {
    return Number((discountPercent * 0.6).toFixed(2));
  }
  if (discountPercent <= 50) {
    return Number((12.0 + (discountPercent - 20) * 0.7).toFixed(2));
  }
  if (discountPercent <= 85) {
    return Number((33.0 + (discountPercent - 50) * 0.34).toFixed(2));
  }
  return 45.0;
}

/**
 * Pillar 2: Historical Context & Price Events (max 35 points)
 */
export function calculateHistoricalScore(priceEvent?: PriceEventType): number {
  switch (priceEvent) {
    case 'NEW_HISTORICAL_LOW':
      return 35.0;
    case 'AT_HISTORICAL_LOW':
      return 28.0;
    case 'NEAR_HISTORICAL_LOW':
      return 20.0;
    case 'MAJOR_DROP':
    case 'EXTREME_DROP':
      return 15.0;
    case 'MINOR_DROP':
      return 8.0;
    case 'NONE':
    default:
      return 0.0;
  }
}

/**
 * Pillar 3: Merchant Trust & Source Agreement (max 20 points)
 */
export function calculateTrustScore(
  isOfficial: boolean,
  merchantTrustScore: number = 1.0,
  sourceAgreementCount: number = 1
): number {
  // Merchant trust component (max 10)
  let merchantPoints = 2.0;
  if (isOfficial) {
    merchantPoints = 10.0;
  } else if (merchantTrustScore >= 0.8) {
    merchantPoints = 6.0;
  }

  // Source consensus component (max 10)
  let sourcePoints = 4.0;
  if (sourceAgreementCount >= 3) {
    sourcePoints = 10.0;
  } else if (sourceAgreementCount === 2) {
    sourcePoints = 7.0;
  }

  return Number((merchantPoints + sourcePoints).toFixed(2));
}

/**
 * Pillar 4: Risk Penalty & Confidence Multiplier
 */
export function getRiskPenalty(riskLevel: PriceRiskLevel = 'SAFE'): number {
  switch (riskLevel) {
    case 'HIGH':
      return 60.0;
    case 'MEDIUM':
      return 25.0;
    case 'LOW':
      return 5.0;
    case 'SAFE':
    default:
      return 0.0;
  }
}

export function getDealScoreTier(score: number): DealScoreTier {
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Great';
  if (score >= 40) return 'Fair';
  return 'Weak';
}

/**
 * Deterministic Composite Deal Score (0 - 100)
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  // 1. Calculate discount percent if not provided explicitly
  let discountPercent = input.discountPercent ?? 0;
  const basePrice = input.basePriceEur || input.originalPriceEur;
  if (discountPercent === 0 && basePrice && basePrice > 0 && input.priceEur < basePrice) {
    discountPercent = Math.round(((basePrice - input.priceEur) / basePrice) * 100);
  }

  // 2. Score pillars
  const discountScore = calculateDiscountScore(discountPercent);
  const historicalScore = calculateHistoricalScore(input.priceEvent);
  const isOfficial = input.isOfficialMerchant ?? true;
  const trustScore = calculateTrustScore(
    isOfficial, 
    input.merchantTrustScore ?? 1.0, 
    input.sourceAgreementCount ?? 1
  );

  const subtotal = discountScore + historicalScore + trustScore;

  // 3. Multipliers and penalties
  const confRaw = input.evaluationConfidence !== undefined ? input.evaluationConfidence : 1.0;
  const clampedConf = Math.max(0.0, Math.min(1.0, confRaw));
  const confidenceMultiplier = Number((0.70 + 0.30 * clampedConf).toFixed(4));

  const riskPenalty = getRiskPenalty(input.riskLevel);
  const rawScore = subtotal * confidenceMultiplier - riskPenalty;

  let finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Safety guard: HIGH risk or marked anomaly cannot exceed 35
  if (input.riskLevel === 'HIGH' || input.isAnomaly === true) {
    finalScore = Math.min(finalScore, 35);
  }

  return {
    score: finalScore,
    tier: getDealScoreTier(finalScore),
    components: {
      discountScore,
      historicalScore,
      trustScore,
      subtotal,
      confidenceMultiplier,
      riskPenalty,
      rawScore: Number(rawScore.toFixed(3))
    }
  };
}
