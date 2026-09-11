import type { PriceEventType } from '../../../shared/types.js';
import type { PriceEventInput } from './types.js';

/**
 * Evaluates the market event of an offer (discount magnitude, historical record, price direction).
 * Trust-free: replaces the former riskLevel gate with the pure isPricingError boolean flag.
 */
export function detectPriceEvent(
  input: PriceEventInput,
  isPricingError: boolean = false
): PriceEventType {
  const currentPriceEur = input.currentPriceEur ?? input.priceEur ?? 0;
  const originalPriceEur = input.originalPriceEur ?? input.claimedOriginalPriceEur;
  const basePriceEur = input.basePriceEur ?? input.steamBasePriceEur;
  const historicalLowEur = input.historicalLowEur ?? input.confirmedAtlEur;
  const previousPriceEur = input.previousPriceEur;
  const isOfficialMerchant = input.isOfficialMerchant ?? false;
  const sourceAgreementCount = input.sourceAgreementCount ?? 1;
  const independentMerchantCount = input.independentMerchantCount ?? 1;

  if (currentPriceEur <= 0) {
    return 'NONE';
  }

  // When detector flags the offer as a pricing error -> PRICING_ERROR
  if (isPricingError) {
    return 'PRICING_ERROR';
  }

  // 1. Check for price increase vs previous price
  if (previousPriceEur !== undefined && previousPriceEur > 0 && currentPriceEur > previousPriceEur) {
    return 'PRICE_INCREASE';
  }

  // 2. Check for Historical Low records (new records take precedence)
  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || independentMerchantCount >= 2 || isOfficialMerchant) && !isPricingError;
  const isAtAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.02 && !isPricingError;
  const isNearAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.10 && !isPricingError;

  // Confirmed new historical low record
  if (isConfirmedAtl) {
    return 'RECORD_DROP';
  }

  // Suspected unconfirmed new ATL (keyshop outlier or single source)
  if (isNewAtl) {
    return 'UNCONFIRMED_RECORD_DROP';
  }

  // 3. Magnitude Evaluation against MSRP / Original price
  const msrp = basePriceEur || originalPriceEur || 0;
  const discountPercent = msrp > 0 ? Math.max(0, ((msrp - currentPriceEur) / msrp) * 100) : 0;
  const absoluteDropEur = msrp > 0 ? Math.max(0, msrp - currentPriceEur) : 0;

  // Mega Deal / Extreme Price Collapse:
  // - >=75% discount with >=15€ savings or MSRP >= 20€
  // - >=80% discount with >=10€ savings (great indie / AA deal)
  // - >=70% discount with >=20€ savings
  // - At ATL with >=65% discount and >=15€ savings
  const isExtremeDrop = msrp > 0 && (
    (discountPercent >= 75 && (absoluteDropEur >= 15 || msrp >= 20)) ||
    (discountPercent >= 80 && absoluteDropEur >= 10) ||
    (discountPercent >= 70 && absoluteDropEur >= 20) ||
    (isAtAtl && discountPercent >= 65 && absoluteDropEur >= 15)
  );

  if (isExtremeDrop) {
    return 'EXTREME_DROP';
  }

  // 4. Matches Historical Low (moderate discounts)
  if (isAtAtl) {
    return 'RECORD_DROP';
  }

  // 5. Major Drop:
  // - >=50% discount with >=15€ drop, or >=50% discount on MSRP >= 20€
  // - Near ATL with >=45% discount
  const isMajorDrop = msrp > 0 && (
    (discountPercent >= 50 && (absoluteDropEur >= 15 || msrp >= 20)) ||
    (isNearAtl && discountPercent >= 45)
  );

  if (isMajorDrop) {
    return 'MAJOR_DROP';
  }

  // 6. Near Historical Low
  if (isNearAtl) {
    return 'MAJOR_DROP';
  }

  // 7. Significant drop (30%+ discount or €10+ savings)
  if (discountPercent >= 30 || absoluteDropEur >= 10) {
    return 'SIGNIFICANT_DROP';
  }

  // 8. Standard sale (10%+ discount)
  if (discountPercent >= 10) {
    return 'MODERATE_DROP';
  }

  return 'NONE';
}
