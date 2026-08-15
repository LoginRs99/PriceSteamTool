export type ProductType = 'STEAM_KEY' | 'STEAM_GIFT' | 'DIRECT_PURCHASE';
export type RegionType = 'HU' | 'EU' | 'GLOBAL' | 'RESTRICTED';

export type SourceCode = 'steam' | 'itad' | 'ggdeals' | 'cheapshark' | 'allkeyshop' | 'gocdkeys';

export type CircuitBreakerState = 'NORMAL' | 'BACKOFF' | 'COOLDOWN' | 'PAUSED' | 'DISABLED';
export type CircuitState = CircuitBreakerState;

export type PriceEventType =
  | 'NONE'
  | 'STANDARD_SALE'          // Standard discount (e.g. 15-35% or small absolute drop)
  | 'SIGNIFICANT_DROP'       // Noticeable price drop (e.g. 35-55% or distinct absolute drop)
  | 'MAJOR_DROP'             // Major price drop (e.g. 55-75% or large absolute drop)
  | 'EXTREME_DROP'           // Extreme price drop (>75-80% or massive drop)
  | 'NEW_HISTORICAL_LOW'     // Confirmed new historical low
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
  bestProductType?: ProductType;
  bestRegionType?: RegionType;
  bestDealUrl?: string;
  bestPriceEvent?: PriceEventType;
  bestRiskLevel?: PriceRiskLevel;
  bestEvaluationConfidence?: number;
  
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
  discountPercent?: number;
  voucherCode?: string;
  dealUrl: string;
  isValid: boolean;
  
  // 2D Pricing Engine fields
  priceEvent: PriceEventType;
  riskLevel: PriceRiskLevel;
  riskScore: number;
  riskFlags: PriceRiskFlag[];
  evaluationConfidence: number;
  isAnomaly: boolean;
  anomalyReason?: string;
  
  isBestDeal: boolean;
  sources: SourceCode[];
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryEntry {
  id: string;
  gameId: string;
  merchantId?: string;
  merchantName?: string;
  sourceCode: SourceCode;
  priceEur: number;
  discountPercent?: number;
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

export interface WishlistFilterOptions {
  search?: string;
  sort?: 'priority' | 'price_asc' | 'price_desc' | 'discount_desc' | 'title_asc' | 'historical_low';
  saleOnly?: boolean;
  historicalLowOnly?: boolean;
  underPrice?: number;
  merchantType?: 'all' | 'official' | 'keyshop' | 'official_only' | 'keyshop_only';
  hasAnomaly?: boolean;
  priceEvent?: PriceEventType;
  riskLevel?: PriceRiskLevel;
  page?: number;
  limit?: number;
}
