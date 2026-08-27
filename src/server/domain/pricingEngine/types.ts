export interface PriceEvaluationInput {
  currentPriceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;           // Steam MSRP
  historicalLowEur?: number;
  previousPriceEur?: number;       // Previous recorded price
  marketPricesEur?: number[];      // Other active store prices for this game
  sourceHistoryEur?: number[];      // Prior observed prices from this exact merchant for this game
  sourceAgreementCount: number;    // Distinct source adapters observing this canonical offer
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
