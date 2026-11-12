import type { PriceEventType } from '../../../shared/types.js';
import type { PriceEventInput } from './types.js';

const EPSILON_EUR = 0.005;

/**
 * Evaluates the market event of an offer (discount magnitude, historical record, price direction).
 * Trust-free: replaces the former riskLevel gate with the pure isPricingError boolean flag.
 *
 * Reliably separates:
 * 1. Pricing errors (flagged anomalies)
 * 2. Price increases (current > previous)
 * 3. Confirmed historical low records (strictly lower than known ATL with multi-source or official confirmation)
 * 4. Unconfirmed historical low records (strictly lower than known ATL from single keyshop)
 * 5. Minor fluctuations / currency rounding (< 0.05€ and < 2.0% change)
 * 6. Start of sale from regular MSRP (evaluated against MSRP)
 * 7. Sale deepening (evaluated by relative and absolute drop from previous price)
 * 8. Newly discovered offers on sale (standard sale classification, never false record/extreme drops)
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

  // 1. When detector flags the offer as a pricing error -> PRICING_ERROR
  if (isPricingError) {
    return 'PRICING_ERROR';
  }

  // 2. Check for price increase vs previous price
  if (previousPriceEur !== undefined && previousPriceEur > 0 && currentPriceEur > previousPriceEur + EPSILON_EUR) {
    return 'PRICE_INCREASE';
  }

  // 3. Minor fluctuation filter: micro-movements on existing offers are noise / FX rounding
  if (previousPriceEur !== undefined && previousPriceEur > 0) {
    const priceDeltaEur = previousPriceEur - currentPriceEur;

    // Price did not decrease (within floating point epsilon)
    if (priceDeltaEur <= EPSILON_EUR) {
      return 'NONE';
    }

    // Any micro-decrease of <= 1 cent (<= 0.015€) on an existing offer is pure noise / FX rounding
    if (priceDeltaEur <= 0.015) {
      return 'NONE';
    }

    // Drops under 5 cents with < 5.0% relative movement are also minor fluctuations
    const relativeDropPercent = (priceDeltaEur / previousPriceEur) * 100;
    if (priceDeltaEur < 0.05 && relativeDropPercent < 5.0) {
      return 'NONE';
    }
  }

  // 4. Check for genuine Historical Low records (current price beats previous ATL by >2%)
  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || independentMerchantCount >= 2 || isOfficialMerchant) && !isPricingError;

  if (isConfirmedAtl) {
    return 'RECORD_DROP';
  }

  if (isNewAtl) {
    return 'UNCONFIRMED_RECORD_DROP';
  }

  // 5. Magnitude Evaluation against MSRP / Original price
  const msrp = basePriceEur || originalPriceEur || 0;
  const discountPercent = msrp > 0 ? Math.max(0, ((msrp - currentPriceEur) / msrp) * 100) : 0;
  const absoluteDropEur = msrp > 0 ? Math.max(0, msrp - currentPriceEur) : 0;

  const isAtAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.02 && !isPricingError;
  const isNearAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.10 && !isPricingError;

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

  // 6. Major Drop:
  // - >=50% discount with >=15€ drop, or >=50% discount on MSRP >= 20€
  // - Near ATL with >=45% discount
  const isMajorDrop = msrp > 0 && (
    (discountPercent >= 50 && (absoluteDropEur >= 15 || msrp >= 20)) ||
    (isNearAtl && discountPercent >= 45)
  );

  if (isMajorDrop) {
    return 'MAJOR_DROP';
  }

  // 7. At or near Historical Low with moderate discount (genuine major deal without false record claim)
  if (isAtAtl && discountPercent >= 20) {
    return 'MAJOR_DROP';
  }

  if (isNearAtl && discountPercent >= 20) {
    return 'MAJOR_DROP';
  }

  // 8. Significant drop (30%+ discount or €10+ savings)
  if (discountPercent >= 30 || absoluteDropEur >= 10) {
    return 'SIGNIFICANT_DROP';
  }

  // 9. Standard sale (10%+ discount)
  if (discountPercent >= 10) {
    return 'MODERATE_DROP';
  }

  return 'NONE';
}
