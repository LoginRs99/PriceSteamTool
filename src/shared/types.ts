export type ProductType = 'STEAM_KEY' | 'STEAM_GIFT' | 'DIRECT_PURCHASE';
export type RegionType = 'HU' | 'EU' | 'GLOBAL' | 'RESTRICTED';

export type SourceCode = 'steam' | 'itad' | 'ggdeals' | 'cheapshark' | 'allkeyshop';

export type CircuitBreakerState = 'NORMAL' | 'BACKOFF' | 'COOLDOWN' | 'PAUSED' | 'DISABLED';
export type CircuitState = CircuitBreakerState;

export type PriceEventType = 
  | 'NEW_HISTORICAL_LOW' 
  | 'AT_HISTORICAL_LOW' 
  | 'SUSPECTED_HISTORICAL_LOW'
  | 'NEAR_HISTORICAL_LOW'
  | 'MAJOR_DROP' 
  | 'SIGNIFICANT_DROP'
  | 'EXTREME_DROP' 
  | 'PRICE_INCREASE' 
  | 'STANDARD_SALE'
  | 'NONE';

export type PriceRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'SUSPICIOUS' | 'HIGH';

export type PriceRiskFlag = 
  | 'UNREALISTIC_DISCOUNT'         // > 95% discount on paid game
  | 'EXTREME_UNDER_ATL'            // Price > 50% below verified ATL
  | 'ANOMALOUS_Z_SCORE'            // Statistical outlier compared to cluster
  | 'SINGLE_UNVERIFIED_SOURCE'     // Only 1 unverified source reports this price
  | 'FRESH_RELEASE_UNEXPECTED_DROP'// < 3 months old game with unlikely huge drop
  | 'UNCONFIRMED_KEYSHOP'          // Marketplace listing without multi-source confirmation
  | 'SOURCE_DISAGREEMENT'          // Strong conflict between source observations
  | 'STALE_OBSERVATION'            // Stale observation (affects confidence, not pricing risk)
  | 'MISSING_MSRP_ANCHOR'          // No verified MSRP baseline available
  | 'SUB_EURO_PREMIUM_GLITCH'
  | 'EXTREME_MEDIAN_OUTLIER'
  | 'LONE_BOTTOM_OUTLIER'
  | 'HISTORICAL_LOW_DISCREPANCY';

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
  preferredCurrency?: string;
  preferredCountry?: string;
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
  qualityScore?: number;
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
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
  basePriceEur?: number;
  historicalLowEur?: number;
  historicalLowDate?: string;
  historicalLowSource?: string;
  
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
  bestMerchantTrustScore?: number;
  bestProductType?: ProductType;
  bestRegionType?: RegionType;
  bestDealUrl?: string;
  bestPriceEvent?: PriceEventType;
  bestRiskLevel?: PriceRiskLevel;
  bestDealScore?: number;
  bestDealTier?: DealScoreTier;
  bestConfidenceScore?: number;
  bestConfidenceTier?: ConfidenceTier;
  bestIsProvisional?: boolean;
  bestZScore?: number;
  bestEffectiveSigma?: number;
  bestSavingVsMedianEur?: number;
  bestAtlDistanceEur?: number;
  valueRankingScore?: number; // Monotonic value score combining Deal Score & Confidence
  
  // Action Signal Engine recommendation
  actionSignal?: ActionSignal;
  
  // Wishlist metadata
  priority?: number;
  dateAddedSteam?: string;
  targetPriceEur?: number;
  
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
  trustScore?: number;
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
  
  // 2D Pricing Engine & Deal Score fields
  priceEvent: PriceEventType;
  riskLevel: PriceRiskLevel;
  riskScore?: number;
  riskFlags?: PriceRiskFlag[];
  evaluationConfidence?: number;
  isAnomaly: boolean;
  anomalyReason?: string;
  dealScore?: number;
  dealTier?: DealScoreTier;
  confidenceScore?: number;
  confidenceTier?: ConfidenceTier;
  isProvisional?: boolean;
  
  isBestDeal: boolean;
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
  priority?: number;
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
  steamAppId?: number;
  offerId: string;
  merchantName: string;
  priceEur?: number;
  originalPriceEur?: number;
  dealUrl?: string;
  anomalyType: string;
  score: number;
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
  cooldownHours?: number;
}

export interface SyncProgressUpdate {
  runId?: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
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
  lastCoreSyncAt?: string;
  lastEnrichmentAt?: string;
  enrichmentProgress?: {
    total: number;
    processed: number;
    offersFound: number;
    currentGameTitle?: string;
  };
}

export type ViewMode = 'grid' | 'list' | 'table';
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
  trustedOnly?: boolean;
  isFreeOnly?: boolean;
  underPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  minDealScore?: number;
  minConfidence?: number;
  hideAnomalies?: boolean;
  hideProvisional?: boolean;
  buyOnly?: boolean;
  actionDecision?: ActionDecision[];
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
