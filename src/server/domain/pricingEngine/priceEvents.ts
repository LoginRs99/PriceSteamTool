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

  // 2. Check for Historical Low
  if (historicalLowEur !== undefined && historicalLowEur > 0) {
    if (currentPriceEur < historicalLowEur * 0.98) {
      // Confirmed if high confidence or multi-source consensus and not high risk
      if ((sourceAgreementCount >= 2 || (isOfficialMerchant && confidence >= 0.70)) && riskLevel !== 'HIGH') {
        return 'NEW_HISTORICAL_LOW';
      }
      return 'SUSPECTED_HISTORICAL_LOW';
    } else if (currentPriceEur <= historicalLowEur * 1.02 && riskLevel !== 'HIGH') {
      return 'AT_HISTORICAL_LOW';
    } else if (currentPriceEur <= historicalLowEur * 1.10 && riskLevel !== 'HIGH') {
      return 'NEAR_HISTORICAL_LOW';
    }
  }

  // 3. Magnitude Evaluation against MSRP / Original price
  const msrp = basePriceEur || originalPriceEur || 0;
  if (msrp <= 0) {
    return 'NONE';
  }

  const discountPercent = Math.max(0, ((msrp - currentPriceEur) / msrp) * 100);
  const absoluteDropEur = Math.max(0, msrp - currentPriceEur);

  // High-value titles (MSRP >= 30€) or large drops
  if (discountPercent >= 75 && (absoluteDropEur >= 25 || msrp >= 30)) {
    return 'EXTREME_DROP';
  }

  if (discountPercent >= 50 && absoluteDropEur >= 15) {
    return 'MAJOR_DROP';
  }

  if (discountPercent >= 30 || absoluteDropEur >= 10) {
    return 'SIGNIFICANT_DROP';
  }

  if (discountPercent >= 10) {
    return 'STANDARD_SALE';
  }

  return 'NONE';
}
