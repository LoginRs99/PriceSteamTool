import type { PriceEventType, PricingErrorType, PricingErrorEvaluation } from '../../../shared/types.js';

/**
 * v2.4.0 (ADR-1): pre-computed result of a same-source-family internal
 * consistency check (e.g. GG.deals "Official" vs "Keyshops" sub-categories
 * disagreeing wildly). Computed once at ingestion time by the source
 * adapter itself (it has both sibling prices in scope); the detector just
 * consumes the verdict. See detectSourceFamilyConflict() in detector.ts.
 */
export interface SourceFamilyConflict {
  ratio: number;
  details: string;
}

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
  isOfficialMerchant?: boolean;
  /** v2.4.0 ADR-1 */
  sourceFamilyConflict?: SourceFamilyConflict;
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
  isDelisted?: boolean;
  isUnreleased?: boolean;
  atlIsConfirmed?: boolean;
  typicalSaleMedianEur?: number;
  /** v2.4.0 ADR-1 */
  sourceFamilyConflict?: SourceFamilyConflict;
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
  merchantTrustScore?: number;
  gameReleaseDate?: string;
  suspectedEditionInversion?: boolean;
  isDelisted?: boolean;
  isUnreleased?: boolean;
  atlIsConfirmed?: boolean;
  isConfirmedAtl?: boolean;
  isStaleObservation?: boolean;
  productType?: string;
  regionConfidence?: number;
  /** v2.4.0 ADR-1 */
  sourceFamilyConflict?: SourceFamilyConflict;
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
  isOfficial?: boolean;
  isOfficialMerchant?: boolean;
  merchantTrustScore?: number;
  gameReleaseDate?: string;
  isDelisted?: boolean;
  isUnreleased?: boolean;
}

export interface PriceRiskInput extends PriceMovementInput {
  previousPriceEur?: number;
}

export type { PricingErrorType, PricingErrorEvaluation, PriceEventType };
