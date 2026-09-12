import type { PriceEventType, PricingErrorType, PricingErrorEvaluation } from '../../../shared/types.js';

export interface PricingErrorInput {
  priceEur: number;
  steamBasePriceEur?: number;
  claimedOriginalPriceEur?: number;
  confirmedAtlEur?: number;
  atlIsConfirmed?: boolean;
  typicalSaleMedianEur?: number;
  otherFreshPricesEur?: number[];
  independentMerchantCount?: number;
  ownHistoryEur?: number[];
  gameReleaseDate?: string;
  suspectedEditionInversion?: boolean;
  isDelisted?: boolean;
  isUnreleased?: boolean;
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
  gameReleaseDate?: string;
  productType?: string;
  regionConfidence?: number;
  isStaleObservation?: boolean;
  suspectedEditionInversion?: boolean;
  isDelisted?: boolean;
  isUnreleased?: boolean;
  atlIsConfirmed?: boolean;
  typicalSaleMedianEur?: number;
}

export interface PriceMovementInput {
  currentPriceEur?: number;
  priceEur?: number;
  originalPriceEur?: number;
  basePriceEur?: number;
  historicalLowEur?: number;
  confirmedAtlEur?: number;
  previousPriceEur?: number;
  typicalSaleMedianEur?: number;
  medianEur?: number;
  marketPricesEur?: number[];
  otherFreshPricesEur?: number[];
  sourceHistoryEur?: number[];
  sourceAgreementCount?: number;
  independentMerchantCount?: number;
  isOfficialMerchant?: boolean;
  gameReleaseDate?: string;
  suspectedEditionInversion?: boolean;
  isDelisted?: boolean;
  isUnreleased?: boolean;
  atlIsConfirmed?: boolean;
  isConfirmedAtl?: boolean;
  isStaleObservation?: boolean;
  productType?: string;
  regionConfidence?: number;
}

export interface OfferAnomalyInput {
  priceEur?: number;
  currentPriceEur?: number;
  originalPriceEur?: number;
  basePriceEur?: number;
  historicalLowEur?: number;
  confirmedAtlEur?: number;
  atlIsConfirmed?: boolean;
  isConfirmedAtl?: boolean;
  typicalSaleMedianEur?: number;
  medianEur?: number;
  otherPrices?: number[];
  marketPricesEur?: number[];
  independentMerchantCount?: number;
  gameReleaseDate?: string;
  isDelisted?: boolean;
  isUnreleased?: boolean;
}

export interface PriceRiskInput extends PriceMovementInput {
  previousPriceEur?: number;
}

export type { PricingErrorType, PricingErrorEvaluation, PriceEventType };
