import type { PriceEventType, PriceRiskLevel } from '../../../shared/types.js';
import type { PriceEvaluationInput } from './types.js';

/**
 * Evaluates the market event of an offer (discount magnitude, historical record, price direction).
 */
export function detectPriceEvent(input: PriceEvaluationInput, confidence: number, riskLevel: PriceRiskLevel): PriceEventType {
  const { currentPriceEur, originalPriceEur, basePriceEur, historicalLowEur, previousPriceEur, isOfficialMerchant, sourceAgreementCount } = input;
  
  if (currentPriceEur <= 0) {
    return 'NONE';
  }

  // 1. Check for price increase vs previous price
  if (previousPriceEur !== undefined && previousPriceEur > 0 && currentPriceEur > previousPriceEur) {
    return 'PRICE_INCREASE';
  }

  // 2. Check for Historical Low records (new records take precedence)
  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || (isOfficialMerchant && confidence >= 0.70)) && riskLevel !== 'HIGH';
  const isAtAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.02 && riskLevel !== 'HIGH';
  const isNearAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.10 && riskLevel !== 'HIGH';

  // Confirmed new historical low record
  if (isConfirmedAtl) {
    return 'NEW_HISTORICAL_LOW';
  }

  // Suspected unconfirmed new ATL (keyshop outlier or single source)
  if (isNewAtl) {
    return 'SUSPECTED_HISTORICAL_LOW';
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

  // 4. Matches Historical Low (smaller discounts)
  if (isAtAtl) {
    return 'AT_HISTORICAL_LOW';
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
    return 'NEAR_HISTORICAL_LOW';
  }

  // 7. Significant drop (30%+ discount or €10+ savings)
  if (discountPercent >= 30 || absoluteDropEur >= 10) {
    return 'SIGNIFICANT_DROP';
  }

  // 8. Standard sale (10%+ discount)
  if (discountPercent >= 10) {
    return 'STANDARD_SALE';
  }

  return 'NONE';
}
