import type { PriceEventType, PricingErrorType, PricingErrorEvaluation } from '../../../shared/types.js';

export interface PricingErrorInput {
  priceEur: number;
  steamBasePriceEur?: number;
  claimedOriginalPriceEur?: number;
  confirmedAtlEur?: number;
  otherFreshPricesEur?: number[];
  independentMerchantCount?: number;
  ownHistoryEur?: number[];
  gameReleaseDate?: string;
  suspectedEditionInversion?: boolean;
}

export interface PriceEventInput {
  currentPriceEur?: number;
  priceEur?: number;
  originalPriceEur?: number;
  claimedOriginalPriceEur?: number;
  basePriceEur?: number;
  steamBasePriceEur?: number;
  historicalLowEur?: number;
  confirmedAtlEur?: number;
  previousPriceEur?: number;
  isOfficialMerchant?: boolean;
  sourceAgreementCount?: number;
  independentMerchantCount?: number;
}

export interface PriceEvaluationInput {
  currentPriceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;
  historicalLowEur?: number;
  previousPriceEur?: number;
  marketPricesEur?: number[];
  sourceHistoryEur?: number[];
  sourceAgreementCount?: number;
  independentMerchantCount?: number;
  isOfficialMerchant?: boolean;
  merchantTrustScore?: number;
  gameReleaseDate?: string;
  productType?: string;
  regionConfidence?: number;
  isStaleObservation?: boolean;
  suspectedEditionInversion?: boolean;
}

export type { PricingErrorType, PricingErrorEvaluation, PriceEventType };
