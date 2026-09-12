export type ProductType = 'STEAM_KEY' | 'STEAM_GIFT' | 'DIRECT_PURCHASE';
export type RegionType = 'HU' | 'EU' | 'GLOBAL' | 'RESTRICTED';

export type SourceCode = 'steam' | 'itad' | 'ggdeals' | 'cheapshark' | 'allkeyshop';

export type CircuitBreakerState = 'NORMAL' | 'BACKOFF' | 'COOLDOWN' | 'PAUSED' | 'DISABLED';
export type CircuitState = CircuitBreakerState;

export type PriceEventType = 
  | 'RECORD_DROP' 
  | 'UNCONFIRMED_RECORD_DROP' 
  | 'EXTREME_DROP' 
  | 'MAJOR_DROP' 
  | 'SIGNIFICANT_DROP' 
  | 'MODERATE_DROP' 
  | 'PRICE_INCREASE' 
  | 'PRICING_ERROR' 
  | 'NONE'
  | 'NEW_HISTORICAL_LOW' 
  | 'AT_HISTORICAL_LOW' 
  | 'SUSPECTED_HISTORICAL_LOW'
  | 'NEAR_HISTORICAL_LOW'
  | 'STANDARD_SALE';

export type PricingErrorType = 
  | 'DECIMAL_SHIFT' 
  | 'MARKET_OUTLIER' 
  | 'BELOW_ATL_IMPLAUSIBLE' 
  | 'EDITION_INVERSION' 
  | 'OWN_HISTORY_BREAK' 
  | 'FRESH_RELEASE_DROP' 
  | 'FAKE_BASELINE';

export type DealVerdict = 'INSTANT_BUY' | 'GREAT_DEAL' | 'FAIR_DEAL' | 'WAIT' | 'OVERPRICED';

export interface PricingErrorEvaluation {
  isLikelyPricingError: boolean;
  confidence: number;
  type: PricingErrorType | null;
  reason: string | null;
}

export interface Profile {
  id: string;
  name: string;
  steamId: string;
  customUrl?: string;
  avatarUrl?: string;
  preferredCurrency?: string;
  preferredCountry?: string;
  isActive: boolean;
  isFamily?: boolean;
  familyGamesCount?: number;
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
  createdAt?: string;
}

export type DealScoreTier = 'Exceptional' | 'Great' | 'Good' | 'Fair' | 'Weak';
export type ConfidenceTier = 'High' | 'Medium' | 'Moderate' | 'Low';
export type ActionDecision = 'STRONG_BUY' | 'BUY' | 'FAIR' | 'WAIT' | 'HOLD' | 'PROVISIONAL';

export interface ActionSignal {
  decision: ActionDecision;
  badgeLabel: string;
  badgeColor: string;
  primaryReason: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  timingContext: string;
  expectedSaleTargetEur?: number;
  expectedSaleMinEur?: number;
  expectedSaleMaxEur?: number;
  avgDaysBetweenSales?: number;
  daysSinceLastSale?: number;
  isSaleOverdue?: boolean;
  upcomingEventName?: string;
  daysUntilUpcomingEvent?: number;
}

export interface Game {
  id: string;
  steamAppId: number;
  itadId?: string;
  title: string;
  slug: string;
  headerImage?: string;
  capsuleImage?: string;
  iconUrl?: string;
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
  isFamilyShared?: boolean;
  basePriceEur?: number;
  historicalLowEur?: number;
  historicalLowDate?: string;
  historicalLowSource?: string;
  
  // Steam Review Sentiment & Ratings
  steamReviewDesc?: string;
  steamReviewPercent?: number;
  steamReviewTotal?: string;
  steamdbRating?: number;
  metacriticScore?: number;
  metacriticUrl?: string;
  
  // Statistical Historical Anchors
  typicalSaleMedianEur?: number;
  typicalSaleQ1Eur?: number;
  typicalSaleQ3Eur?: number;
  typicalSaleSampleCount?: number;
  low90dEur?: number;
  low1yEur?: number;
  atlIsConfirmed?: boolean;
  atlIsSingleSourceLow?: boolean;
  
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
  bestLastObservedAt?: string;
  bestIsFresh?: boolean;
  bestDealScore?: number;
  bestDealTier?: DealScoreTier;
  bestVerdict?: DealVerdict;
  bestScoreComponents?: DealScoreResult['components'];
  bestConfidenceScore?: number;
  bestConfidenceTier?: ConfidenceTier;
  bestIsProvisional?: boolean;
  bestSavingVsMedianEur?: number;
  bestAtlDistanceEur?: number;
  valueRankingScore?: number; // Monotonic value score combining Deal Score & Confidence
  
  // Action Signal Engine recommendation
  actionSignal?: ActionSignal;
  
  // Wishlist metadata
  priority?: number;
  dateAddedSteam?: string;
  targetPriceEur?: number;
  
  // AllKeyShop Adaptive Pacing State
  allkeyshopLastCheckedAt?: string;
  allkeyshopCheckIntervalHours?: number;
  allkeyshopUnchangedStreak?: number;
  allkeyshopLastPriceEur?: number;
  
  // Historical Backfill State
  priceHistorySeededAt?: string;

  hasPricingError: boolean;
  pricingErrorCount?: number;
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
  regionConfidence?: number;
  priceEur: number;
  originalPriceEur?: number;
  rawPrice?: number;
  rawCurrency?: string;
  rawOriginalPrice?: number;
  discountPercent?: number;
  voucherCode?: string;
  dealUrl: string;
  isValid?: boolean;
  
  // Pricing Event & Error Detector fields
  priceEvent: PriceEventType;
  isLikelyPricingError: boolean;
  pricingErrorConfidence?: number;
  pricingErrorType?: PricingErrorType;
  pricingErrorReason?: string;

  dealScore?: number;
  dealTier?: DealScoreTier;
  verdict?: DealVerdict;
  confidenceScore?: number;
  confidenceTier?: ConfidenceTier;
  isProvisional?: boolean;
  
  isBestDeal: boolean;
  isFresh?: boolean;
  sources: SourceCode[];
  sourceAgreementCount?: number;
  fetchedAt: string;
  lastObservedAt: string;
  createdAt?: string;
  updatedAt?: string;
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
  rawPrice?: number;
  rawCurrency?: string;
  fxRate?: number;
  discountPercent?: number;
  priceEvent?: PriceEventType;
  dealScore?: number;
  isOfficial?: boolean;
  isPricingError?: boolean;
  recordedAt: string;
}

export interface SourceStatus {
  code: SourceCode;
  name: string;
  isEnabled: boolean;
  priority?: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  rateLimitCount: number;
  consecutiveFailures?: number;
  consecutiveRateLimits?: number;
  lastRequestAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  cooldownUntil?: string;
  state: CircuitBreakerState;
}

export interface PricingError {
  id: string;
  gameId: string;
  gameTitle: string;
  steamAppId?: number;
  offerId: string;
  merchantName: string;
  priceEur?: number;
  originalPriceEur?: number;
  dealUrl?: string;
  errorType: PricingErrorType | string;
  confidence: number;
  reason: string;
  detectedAt: string;
  isDismissed?: boolean;
  dismissedAt?: string;
}

export interface DiscordSettings {
  webhookUrl?: string;
  isEnabled: boolean;
  minDealScore?: number;
  minConfidence?: number;
  notifyAtlOnly?: boolean;
  notifyFreeGames?: boolean;
  notifyPricingErrors?: boolean;
  cooldownHours?: number;
}

export interface SyncProgressUpdate {
  runId?: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' | 'CANCELLED';
  startedAt?: string;
  completedAt?: string;
  startTime?: number;
  totalGames: number;
  processedGames: number;
  currentAction: string;
  errorMessage?: string;
  sourceProgress: Record<SourceCode, {
    total: number;
    processed: number;
    offersFound: number;
    state: CircuitBreakerState;
  }>;
}

export interface SyncStatusResponse {
  isCoreSyncRunning: boolean;
  isEnrichmentRunning: boolean;
  isHistorySeedingRunning?: boolean;
  lastCoreSyncAt?: string;
  lastEnrichmentAt?: string;
  enrichmentProgress?: {
    total: number;
    processed: number;
    offersFound: number;
    currentGameTitle?: string;
  };
}

export type ViewMode = 'grid' | 'table';
export type MainTab = 'wishlist' | 'free' | 'deals' | 'safety';

export interface WishlistFilterOptions {
  search?: string;
  sort?: 
    | 'best_value' 
    | 'deal_score_desc' 
    | 'confidence_desc' 
    | 'near_atl' 
    | 'biggest_savings' 
    | 'price_drops' 
    | 'priority' 
    | 'price_asc' 
    | 'price_desc' 
    | 'discount_desc' 
    | 'title_asc' 
    | 'historical_low';
  saleOnly?: boolean;
  majorDealsOnly?: boolean;
  allTimeLowOnly?: boolean;
  historicalLowOnly?: boolean;
  isFreeOnly?: boolean;
  underPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  minDiscount?: number;
  minDealScore?: number;
  minConfidence?: number;
  hidePricingErrors?: boolean;
  hideProvisional?: boolean;
  buyOnly?: boolean;
  actionDecision?: ActionDecision[];
  merchantType?: 'all' | 'official' | 'keyshop' | 'official_only' | 'keyshop_only';
  hasPricingErrors?: boolean;
  targetReachedOnly?: boolean;
  hideUnreleased?: boolean;
  hideDlcs?: boolean;
  includeFreeGames?: boolean;
  hideFamilyShared?: boolean;
  steamAppId?: number;
  priceEvent?: PriceEventType;
  page?: number;
  limit?: number;
}

export interface WishlistStatistics {
  totalGames: number;
  freeGamesCount?: number;
  gamesOnSale: number;
  gamesAtHistoricalLow: number;
  majorDropsCount: number;
  gamesWithPricingErrors: number;
  averageDiscountPercent: number;
}

// ----------------------------------------------------
// Price Intelligence Types
// ----------------------------------------------------
export interface PeriodLowEntry {
  priceEur: number | null;
  merchantName?: string;
  recordedAt?: string;
  isOfficial?: boolean;
  observationCount: number;
  isExactPeriodData: boolean;
  isSingleSourceLow?: boolean;
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
  actionSignal?: ActionSignal;
  historicalContextSummary: string;
  chartData: PriceChartData;
}

// ----------------------------------------------------
// Deal Score v2.3 Contract
// ----------------------------------------------------
export interface DealScoreResult {
  score: number; // 0 - 100
  tier: DealScoreTier;
  verdict: DealVerdict;
  baseScore: number;
  rarityBonus: number;
  confidenceScore: number; // 0 - 100 (%)
  confidenceTier: ConfidenceTier;
  isLowSample: boolean;
  isProvisional?: boolean;
  components?: {
    atlProximity: number;
    discountDepth: number;
    historicalValue: number;
    marketPosition: number;
    subtotal: number;
    rawScore: number;
  };
  explanation?: {
    medianSavingEur: number;
    atlDistanceEur: number;
    confidenceFactors: Record<string, number>;
  };
}

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
  
  // Pricing Error & Market Inputs
  isPricingError?: boolean;
  marketMinPriceEur?: number;
  otherOfferCount?: number;
  offersCount?: number;
  minOfferEur?: number;
  maxOfferEur?: number;
  isStalePrice?: boolean;
  daysSinceLastSample?: number;

  // Edge cases
  originalPriceEur?: number;
  isConfirmedAtl?: boolean;
  isSingleSourceLow?: boolean;
  isDelisted?: boolean;
  isUnreleased?: boolean;
}
