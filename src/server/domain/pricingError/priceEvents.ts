import type { PriceEventType } from '../../../shared/types.js';
import type { PriceEventInput } from './types.js';
import { DEFAULT_PRICE_DROP_THRESHOLDS, type PriceDropThresholds } from '../constants.js';

export { DEFAULT_PRICE_DROP_THRESHOLDS, type PriceDropThresholds };

/**
 * Evaluates the market event of an offer (discount magnitude, historical record, price direction).
 * Trust-free: replaces the former riskLevel gate with the pure isPricingError boolean flag.
 *
 * Reliably separates:
 * 1. Pricing errors (flagged anomalies) -> PRICING_ERROR
 * 2. Confirmed historical low records (strictly lower than known ATL with multi-source or official confirmation) -> RECORD_DROP
 * 3. Unconfirmed historical low records (strictly lower than known ATL from single keyshop) -> UNCONFIRMED_RECORD_DROP
 * 4. First-time observations of an offer (not breaking ATL) -> NEW_OFFER (never MAJOR_DROP or EXTREME_DROP)
 * 5. Price increases (current > previous) -> PRICE_INCREASE
 * 6. Minor fluctuations / FX noise (noise floor, < 5% under 0.05€, cheap game noise) -> NONE
 * 7. Genuine price reductions evaluated by actual drop delta from previousPriceEur:
 *    - EXTREME_DROP: >=50% drop and >=2.00€, or >=10.00€ absolute drop
 *    - MAJOR_DROP: >=25% drop and >=1.00€, or >=5.00€ absolute drop
 *    - SIGNIFICANT_DROP: >=15% drop and >=0.75€, or >=3.00€ absolute drop
 *    - MODERATE_DROP: >=10% drop and >=0.50€
 *    - Otherwise: NONE
 */
export function detectPriceEvent(
  input: PriceEventInput,
  isPricingError: boolean = false,
  customThresholds?: Partial<PriceDropThresholds>
): PriceEventType {
  const currentPriceEur = input.currentPriceEur ?? input.priceEur ?? 0;
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

  // 2. Check for genuine Historical Low records (current price beats previous ATL by >2%)
  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || independentMerchantCount >= 2 || isOfficialMerchant) && !isPricingError;

  if (isConfirmedAtl) {
    return 'RECORD_DROP';
  }

  if (isNewAtl) {
    return 'UNCONFIRMED_RECORD_DROP';
  }

  // 3. First-time observation (no prior price recorded for this offer) -> NEW_OFFER
  // Never classify a newly discovered or imported offer as MAJOR_DROP or EXTREME_DROP
  if (previousPriceEur === undefined || previousPriceEur === null || previousPriceEur <= 0) {
    return 'NEW_OFFER';
  }

  const thresholds = customThresholds
    ? { ...DEFAULT_PRICE_DROP_THRESHOLDS, ...customThresholds }
    : DEFAULT_PRICE_DROP_THRESHOLDS;

  // 4. Check for price increase vs previous price
  if (currentPriceEur > previousPriceEur + thresholds.EPSILON_EUR) {
    return 'PRICE_INCREASE';
  }

  // 5. Minor fluctuation filter: micro-movements on existing offers are noise / FX rounding
  const priceDeltaEur = previousPriceEur - currentPriceEur;

  // Price did not decrease (within floating point epsilon)
  if (priceDeltaEur <= thresholds.EPSILON_EUR) {
    return 'NONE';
  }

  // Any micro-decrease <= noise floor (<= 0.015€) on an existing offer is pure noise / FX rounding
  if (priceDeltaEur <= thresholds.NOISE_FLOOR_EUR) {
    return 'NONE';
  }

  const relativeDropPercent = (priceDeltaEur / previousPriceEur) * 100;

  // Drops under 5 cents with < 5.0% relative movement are minor fluctuations
  if (priceDeltaEur < thresholds.MIN_DROP_EUR && relativeDropPercent < thresholds.MIN_DROP_PERCENT) {
    return 'NONE';
  }

  // On low-price games (< 5.00€), drops <= 10 cents with < 5% movement are also noise
  if (previousPriceEur < thresholds.LOW_PRICE_THRESHOLD_EUR && priceDeltaEur <= thresholds.LOW_PRICE_NOISE_EUR && relativeDropPercent < thresholds.MIN_DROP_PERCENT) {
    return 'NONE';
  }

  // 6. Magnitude Evaluation against actual price drop from previous price
  // Extreme Drop: (dropPercent >= 75% AND dropEur >= 2.00€) OR (dropEur >= 15.00€ AND dropPercent >= 35%)
  if (
    (relativeDropPercent >= thresholds.EXTREME_DROP_PERCENT && priceDeltaEur >= thresholds.EXTREME_DROP_MIN_EUR) ||
    (priceDeltaEur >= thresholds.EXTREME_DROP_ABSOLUTE_EUR && relativeDropPercent >= (thresholds.EXTREME_DROP_ABSOLUTE_MIN_PERCENT ?? 35.0))
  ) {
    return 'EXTREME_DROP';
  }

  // Major Drop: >=25% drop with >=1.00€ savings, OR >=5.00€ absolute drop
  if (
    (relativeDropPercent >= thresholds.MAJOR_DROP_PERCENT && priceDeltaEur >= thresholds.MAJOR_DROP_MIN_EUR) ||
    priceDeltaEur >= thresholds.MAJOR_DROP_ABSOLUTE_EUR
  ) {
    return 'MAJOR_DROP';
  }

  // Significant Drop: >=15% drop with >=0.75€ savings, OR >=3.00€ absolute drop
  if (
    (relativeDropPercent >= thresholds.SIGNIFICANT_DROP_PERCENT && priceDeltaEur >= thresholds.SIGNIFICANT_DROP_MIN_EUR) ||
    priceDeltaEur >= thresholds.SIGNIFICANT_DROP_ABSOLUTE_EUR
  ) {
    return 'SIGNIFICANT_DROP';
  }

  // Moderate Drop: >=10% drop with >=0.50€ savings
  if (
    relativeDropPercent >= thresholds.MODERATE_DROP_PERCENT &&
    priceDeltaEur >= thresholds.MODERATE_DROP_MIN_EUR
  ) {
    return 'MODERATE_DROP';
  }

  return 'NONE';
}
