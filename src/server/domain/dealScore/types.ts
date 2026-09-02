import type { PriceEventType, PriceRiskLevel, DealScoreTier, ConfidenceTier } from '../../../shared/types.js';

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
  
  // Data Quality & Anomaly Guards (Passed for metadata / UI flags)
  isAnomaly?: boolean;
  riskLevel?: PriceRiskLevel;

  // Required for Fallback/Edge cases
  originalPriceEur?: number;
  isConfirmedAtl?: boolean;
  isSingleSourceLow?: boolean;
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
