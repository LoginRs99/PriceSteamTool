import type { PriceEventType } from '../../../shared/types.js';

export type PriceRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'SUSPICIOUS' | 'HIGH';

export type PriceRiskFlag = 
  | 'UNREALISTIC_DISCOUNT'
  | 'EXTREME_UNDER_ATL'
  | 'ANOMALOUS_Z_SCORE'
  | 'SINGLE_UNVERIFIED_SOURCE'
  | 'FRESH_RELEASE_UNEXPECTED_DROP'
  | 'UNCONFIRMED_KEYSHOP'
  | 'SOURCE_DISAGREEMENT'
  | 'STALE_OBSERVATION'
  | 'MISSING_MSRP_ANCHOR'
  | 'SUB_EURO_PREMIUM_GLITCH'
  | 'SUB_EURO_PREMIUM_GLITCH_CORROBORATED'
  | 'EXTREME_MEDIAN_OUTLIER'
  | 'LONE_BOTTOM_OUTLIER'
  | 'HISTORICAL_LOW_DISCREPANCY'
  | 'SOURCE_OWN_HISTORY_BREAK'
  | 'SOURCE_OWN_HISTORY_BREAK_CORROBORATED';

export interface PriceEvaluation {
  event: PriceEventType;
  riskLevel: PriceRiskLevel;
  riskScore: number;
  riskFlags: PriceRiskFlag[];
  confidence: number;
  summary: string;
  isAnomaly: boolean;
}

export interface PriceEvaluationInput {
  currentPriceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;           // Steam MSRP
  historicalLowEur?: number;
  previousPriceEur?: number;       // Previous recorded price
  marketPricesEur?: number[];      // Other active store prices for this game
  sourceHistoryEur?: number[];      // Prior observed prices from this exact merchant for this game
  sourceAgreementCount: number;    // Distinct source adapters observing this canonical offer
  independentMerchantCount?: number; // Distinct independent merchants with compatible market offers
  isOfficialMerchant: boolean;     // Official licensed retailer vs marketplace
  merchantTrustScore?: number;     // 0.0 - 1.0
  gameReleaseDate?: string;        // Release date string (ISO)
  productType?: string;            // STEAM_KEY, DIRECT_PURCHASE etc.
  regionConfidence?: number;       // 0.0 - 1.0
  isStaleObservation?: boolean;    // Observation older than 24h/stale
}

export interface SourceHistoryAnomalyResult {
  applicable: boolean;      // false if fewer than 3 prior observations exist
  isBreak: boolean;         // true if current price breaks the source's own pattern
  zScore: number | null;
  ownMedian: number | null;
}
