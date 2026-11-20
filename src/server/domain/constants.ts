/**
 * Canonical domain constants shared across server-side modules.
 *
 * IMPORTANT: Any SQL query that encodes a 72-hour freshness window as a raw numeric literal
 * (e.g. "julianday(...) * 24 <= 72") must be kept in sync with FRESHNESS_WINDOW_MS manually,
 * since SQL strings cannot import a JS constant at runtime.
 */

/** Offer freshness window: an offer observed within this many milliseconds is considered "fresh". */
export const FRESHNESS_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Offer maximum retention: offers not observed within this many days are invalidated during maintenance to prevent zombie offers. */
export const OFFER_MAX_AGE_DAYS = 14;
export const OFFER_MAX_AGE_MS = OFFER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Price drop threshold configuration.
 * Centralizes all drop detection and noise filtering parameters so they can be
 * calibrated and tuned without altering core detection logic.
 */
export interface PriceDropThresholds {
  /** Minimum absolute price drop (in EUR) to not be considered zero/epsilon */
  readonly EPSILON_EUR: number;
  /** Hard floor: drops <= this amount (in EUR) are treated as micro-fluctuation noise regardless of percentage */
  readonly NOISE_FLOOR_EUR: number;
  /** Micro-fluctuation: drop < this amount (EUR) AND relative drop < relative percentage */
  readonly MIN_DROP_EUR: number;
  readonly MIN_DROP_PERCENT: number;
  /** For very cheap games (< 5.00 EUR), drops <= this amount with < relative percent are noise */
  readonly LOW_PRICE_THRESHOLD_EUR: number;
  readonly LOW_PRICE_NOISE_EUR: number;

  /** EXTREME_DROP: (dropPercent >= 50% AND dropEur >= 2.00€) OR dropEur >= 10.00€ */
  readonly EXTREME_DROP_PERCENT: number;
  readonly EXTREME_DROP_MIN_EUR: number;
  readonly EXTREME_DROP_ABSOLUTE_EUR: number;

  /** MAJOR_DROP: (dropPercent >= 25% AND dropEur >= 1.00€) OR dropEur >= 5.00€ */
  readonly MAJOR_DROP_PERCENT: number;
  readonly MAJOR_DROP_MIN_EUR: number;
  readonly MAJOR_DROP_ABSOLUTE_EUR: number;

  /** SIGNIFICANT_DROP: (dropPercent >= 15% AND dropEur >= 0.75€) OR dropEur >= 3.00€ */
  readonly SIGNIFICANT_DROP_PERCENT: number;
  readonly SIGNIFICANT_DROP_MIN_EUR: number;
  readonly SIGNIFICANT_DROP_ABSOLUTE_EUR: number;

  /** MODERATE_DROP: (dropPercent >= 10% AND dropEur >= 0.50€) */
  readonly MODERATE_DROP_PERCENT: number;
  readonly MODERATE_DROP_MIN_EUR: number;
}

export const DEFAULT_PRICE_DROP_THRESHOLDS: PriceDropThresholds = {
  EPSILON_EUR: 0.005,
  NOISE_FLOOR_EUR: 0.015,
  MIN_DROP_EUR: 0.05,
  MIN_DROP_PERCENT: 5.0,
  LOW_PRICE_THRESHOLD_EUR: 5.00,
  LOW_PRICE_NOISE_EUR: 0.10,

  EXTREME_DROP_PERCENT: 50.0,
  EXTREME_DROP_MIN_EUR: 2.00,
  EXTREME_DROP_ABSOLUTE_EUR: 10.00,

  MAJOR_DROP_PERCENT: 25.0,
  MAJOR_DROP_MIN_EUR: 1.00,
  MAJOR_DROP_ABSOLUTE_EUR: 5.00,

  SIGNIFICANT_DROP_PERCENT: 15.0,
  SIGNIFICANT_DROP_MIN_EUR: 0.75,
  SIGNIFICANT_DROP_ABSOLUTE_EUR: 3.00,

  MODERATE_DROP_PERCENT: 10.0,
  MODERATE_DROP_MIN_EUR: 0.50,
};
