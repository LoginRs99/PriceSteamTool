export type ProductType = 'STEAM_KEY' | 'STEAM_GIFT' | 'DIRECT_PURCHASE';
export type RegionType = 'HU' | 'EU' | 'GLOBAL' | 'RESTRICTED';

export type SourceCode = 'steam' | 'itad' | 'ggdeals' | 'cheapshark' | 'allkeyshop' | 'gocdkeys';

export type CircuitBreakerState = 'NORMAL' | 'BACKOFF' | 'COOLDOWN' | 'PAUSED' | 'DISABLED';
export type CircuitState = CircuitBreakerState;

export type PriceEventType =
  | 'NONE'
  | 'STANDARD_SALE'          // Standard discount (e.g. 15-35% or small absolute drop)
  | 'MINOR_DROP'             // Minor price drop
  | 'SIGNIFICANT_DROP'       // Noticeable price drop (e.g. 35-55% or distinct absolute drop)
  | 'MAJOR_DROP'             // Major price drop (e.g. 55-75% or large absolute drop)
  | 'EXTREME_DROP'           // Extreme price drop (>75-80% or massive drop)
  | 'NEW_HISTORICAL_LOW'     // Confirmed new historical low
  | 'AT_HISTORICAL_LOW'      // At historical low (within 2%)
  | 'NEAR_HISTORICAL_LOW'    // Near historical low (within 10%)
  | 'SUSPECTED_HISTORICAL_LOW' // Unverified or low-confidence historical low
  | 'PRICE_INCREASE';        // Price increased compared to previous observation

export type PriceRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type PriceRiskFlag =
  | 'SUB_EURO_PREMIUM_GLITCH'      // < 1.00 € on >= 30 € MSRP game
  | 'EXTREME_MEDIAN_OUTLIER'       // > 75% below active market median
  | 'HISTORICAL_LOW_DISCREPANCY'   // Drop far below previous low without peer confirmation
  | 'SINGLE_UNVERIFIED_SOURCE'     // Only 1 unverified source reports this price
  | 'FRESH_RELEASE_UNEXPECTED_DROP'// < 3 months old game with unlikely huge drop
  | 'UNCONFIRMED_KEYSHOP'          // Marketplace listing without multi-source confirmation
  | 'SOURCE_DISAGREEMENT'          // Strong conflict between source observations
  | 'STALE_OBSERVATION'            // Stale observation (affects confidence, not pricing risk)
  | 'MISSING_MSRP_ANCHOR';         // No verified MSRP baseline available

export interface PriceEvaluation {
  event: PriceEventType;
  riskLevel: PriceRiskLevel;
  riskScore: number;               // 0.00 - 1.00
  riskFlags: PriceRiskFlag[];
  confidence: number;              // 0.00 - 1.00 (Data completeness and consensus certainty)
  summary: string;
  isAnomaly: boolean;              // Derived: riskLevel === 'HIGH'
}

export interface Profile {
  id: string;
  name: string;
  steamId: string;
  customUrl?: string;
  avatarUrl?: string;
  isActive: boolean;
  gameCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Merchant {
  id: string;
  code: string;
  name: string;
  defaultUrl?: string;
  isOfficial: boolean;
  trustScore: number;
  createdAt?: string;
}

export type DealScoreTier = 'Exceptional' | 'Great' | 'Fair' | 'Weak';

export interface Game {
  id: string;
  steamAppId: number;
  itadId?: string;
  title: string;
  slug: string;
  headerImage?: string;
  capsuleImage?: string;
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
  basePriceEur?: number;
  historicalLowEur?: number;
  historicalLowDate?: string;
  historicalLowSource?: string;
  
  // Best Offer computed fields
  bestOfferId?: string;
  bestPriceEur?: number;
  bestDiscountPercent?: number;
  bestMerchantName?: string;
  bestMerchantCode?: string;
  bestMerchantIsOfficial?: boolean;
  bestProductType?: ProductType;
  bestRegionType?: RegionType;
  bestDealUrl?: string;
  bestPriceEvent?: PriceEventType;
  bestRiskLevel?: PriceRiskLevel;
  bestEvaluationConfidence?: number;
  bestDealScore?: number;
  bestDealTier?: DealScoreTier;
  
  // Wishlist metadata
  priority?: number;
  dateAddedSteam?: string;
  
  hasAnomaly: boolean;
  anomalyCount?: number;
  offersCount: number;
  
  createdAt: string;
  updatedAt: string;
}

export interface Offer {
  id: string;
  gameId: string;
  merchantId: string;
  merchantName: string;
  merchantCode: string;
  isOfficial: boolean;
  productType: ProductType;
  regionType: RegionType;
  regionCode?: string;
  regionConfidence: number;
  priceEur: number;
  originalPriceEur?: number;
  rawPrice?: number;
  rawCurrency?: string;
  rawOriginalPrice?: number;
  discountPercent?: number;
  voucherCode?: string;
  dealUrl: string;
  isValid: boolean;
  
  // 2D Pricing Engine & Deal Score fields
  priceEvent: PriceEventType;
  riskLevel: PriceRiskLevel;
  riskScore: number;
  riskFlags: PriceRiskFlag[];
  evaluationConfidence: number;
  isAnomaly: boolean;
  anomalyReason?: string;
  dealScore?: number;
  dealTier?: DealScoreTier;
  
  isBestDeal: boolean;
  sources: SourceCode[];
  sourceAgreementCount: number;
  fetchedAt: string;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceObservation {
  id: string;
  offerId: string;
  sourceCode: SourceCode;
  observedPriceEur: number;
  observedRawPrice?: number;
  observedCurrency?: string;
  observedAt: string;
  rawDataJson?: string;
}

export interface PriceHistoryEntry {
  id: string;
  gameId: string;
  merchantId?: string;
  merchantName?: string;
  sourceCode: SourceCode;
  priceEur: number;
  discountPercent?: number;
  priceEvent?: PriceEventType;
  dealScore?: number;
  isOfficial?: boolean;
  recordedAt: string;
}

export interface SourceStatus {
  code: SourceCode;
  name: string;
  isEnabled: boolean;
  requestCount: number;
  successCount: number;
  failureCount: number;
  rateLimitCount: number;
  lastRequestAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  cooldownUntil?: string;
  state: CircuitBreakerState;
}

export interface Anomaly {
  id: string;
  gameId: string;
  gameTitle: string;
  offerId: string;
  merchantName: string;
  priceEur?: number;
  anomalyType: string;
  score: number;
  reason: string;
  detectedAt: string;
  isDismissed?: boolean;
  dismissedAt?: string;
}

export interface SyncProgressUpdate {
  runId: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  totalGames: number;
  processedGames: number;
  currentAction: string;
  sourceProgress: Record<SourceCode, {
    total: number;
    processed: number;
    offersFound: number;
    state: CircuitBreakerState;
  }>;
}

export type ViewMode = 'grid' | 'list' | 'table';
export type MainTab = 'wishlist' | 'free' | 'deals';

export interface WishlistFilterOptions {
  search?: string;
  sort?: 'priority' | 'price_asc' | 'price_desc' | 'discount_desc' | 'title_asc' | 'historical_low' | 'deal_score_desc';
  saleOnly?: boolean;
  majorDealsOnly?: boolean;
  allTimeLowOnly?: boolean;
  historicalLowOnly?: boolean;
  trustedOnly?: boolean;
  isFreeOnly?: boolean;
  underPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  merchantType?: 'all' | 'official' | 'keyshop' | 'official_only' | 'keyshop_only';
  hasAnomaly?: boolean;
  priceEvent?: PriceEventType;
  riskLevel?: PriceRiskLevel;
  page?: number;
  limit?: number;
}

export interface WishlistStatistics {
  totalGames: number;
  freeGamesCount?: number;
  gamesOnSale: number;
  gamesAtHistoricalLow: number;
  majorDropsCount: number;
  gamesWithHighRiskOffers: number;
  averageDiscountPercent: number;
}

// ----------------------------------------------------
// v1.3 Price Intelligence Types
// ----------------------------------------------------
export interface PeriodLowEntry {
  priceEur: number | null;
  merchantName?: string;
  recordedAt?: string;
  isOfficial?: boolean;
  observationCount: number;
  isExactPeriodData: boolean;
}

export interface TypicalSalePrice {
  medianPriceEur: number | null;
  q1PriceEur?: number;
  q3PriceEur?: number;
  sampleCount: number;
  isLowConfidence: boolean;
}

export interface MarketComparison {
  marketMedianEur: number;
  minOfficialPriceEur?: number;
  minTrustedPriceEur?: number;
  totalCompatibleOffers: number;
  currentRank: number;
  percentBelowMarketMedian: number;
}

export interface SaleFrequency {
  saleEventsLast12m: number;
  avgDaysBetweenSales?: number;
  frequencyCategory: 'Frequent' | 'Regular' | 'Rare';
}

export interface PriceVolatility {
  score: number; // 0.0 - 1.0
  category: 'Stable' | 'Moderate' | 'Volatile';
  rawCv: number;
  priceChangesCount: number;
}

export interface PurchaseAdvice {
  decision: 'BUY' | 'FAIR' | 'WAIT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  headline: string;
  reasoning: string[];
}

export interface PriceChartPoint {
  timestamp: string;
  priceEur: number;
  merchantName: string;
  isOfficial: boolean;
  discountPercent: number;
  priceEvent?: PriceEventType;
  dealScore?: number;
}

export interface PriceChartData {
  points: PriceChartPoint[];
  basePriceEur?: number;
  historicalLowEur?: number;
  typicalSaleMedianEur?: number;
  minPrice: number;
  maxPrice: number;
  startDate: string;
  endDate: string;
}

export interface PriceIntelligenceResponse {
  gameId: string;
  currentPrice: {
    priceEur: number;
    basePriceEur?: number;
    discountPercent: number;
    merchantName: string;
    isOfficial: boolean;
    dealScore?: number;
    dealTier?: DealScoreTier;
  };
  periodLows: {
    low7d: PeriodLowEntry;
    low30d: PeriodLowEntry;
    low90d: PeriodLowEntry;
    low1y: PeriodLowEntry;
    allTimeLow: {
      priceEur: number;
      recordedAt?: string;
      source?: string;
      isConfirmed: boolean;
    };
  };
  typicalSale: TypicalSalePrice;
  marketComparison: MarketComparison;
  frequency: SaleFrequency;
  volatility: PriceVolatility;
  advice: PurchaseAdvice;
  historicalContextSummary: string;
  chartData: PriceChartData;
}

