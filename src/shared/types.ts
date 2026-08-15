/**
 * Shared Domain Types across Backend and Frontend
 */

export type ProductType = 'STEAM_KEY' | 'STEAM_GIFT' | 'DIRECT_PURCHASE';

export type RegionType = 'GLOBAL' | 'EU' | 'HU' | 'RESTRICTED';

export type SourceCode = 'steam' | 'itad' | 'ggdeals' | 'cheapshark' | 'allkeyshop' | 'gocdkeys';

export type CircuitState = 'NORMAL' | 'BACKOFF' | 'PAUSED' | 'COOLDOWN';

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
  // Dynamic best offer fields calculated during queries
  bestPriceEur?: number;
  bestMerchantName?: string;
  bestMerchantCode?: string;
  bestProductType?: ProductType;
  bestRegionType?: RegionType;
  bestDiscountPercent?: number;
  bestDealUrl?: string;
  bestOfferId?: string;
  hasAnomaly?: boolean;
  offersCount?: number;
  priority?: number;
  dateAddedSteam?: string;
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
  discountPercent: number;
  voucherCode?: string;
  dealUrl: string;
  isBestDeal: boolean;
  isValid: boolean;
  isAnomaly: boolean;
  anomalyScore: number;
  anomalyReason?: string;
  sources: SourceCode[];
  fetchedAt: string;
}

export interface SourceObservation {
  id: string;
  offerId: string;
  sourceCode: SourceCode;
  observedPriceEur: number;
  observedAt: string;
}

export interface PriceHistoryEntry {
  id: string;
  gameId: string;
  merchantName: string;
  sourceCode: SourceCode;
  priceEur: number;
  discountPercent?: number;
  recordedAt: string;
}

export interface Anomaly {
  id: string;
  gameId: string;
  offerId: string;
  gameTitle?: string;
  merchantName?: string;
  anomalyType: 'EXTREME_DISCOUNT' | 'SUDDEN_DROP' | 'UNVERIFIED_MERCHANT_DISCREPANCY';
  score: number;
  reason: string;
  detectedAt: string;
  isDismissed: boolean;
}

export interface SourceStatus {
  code: SourceCode;
  name: string;
  isEnabled: boolean;
  priority: number;
  state: CircuitState;
  requestCount: number;
  successCount: number;
  failureCount: number;
  rateLimitCount: number;
  lastSuccessAt?: string;
  lastError?: string;
  cooldownUntil?: string;
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
    state: CircuitState;
    message?: string;
  }>;
}

export interface WishlistFilterOptions {
  search?: string;
  sort?: 'priority' | 'price_asc' | 'price_desc' | 'discount_desc' | 'title_asc' | 'historical_low';
  saleOnly?: boolean;
  historicalLowOnly?: boolean;
  underPrice?: number;
  merchantType?: 'all' | 'official_only' | 'keyshop_only';
  hasAnomaly?: boolean;
  page?: number;
  limit?: number;
}
