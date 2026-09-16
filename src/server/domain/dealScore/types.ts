import type { PriceEventType, DealScoreTier, ConfidenceTier, DealVerdict, DealScoreInput, DealScoreResult } from '../../../shared/types.js';

export type { DealScoreInput, DealScoreResult, DealVerdict, DealScoreTier, ConfidenceTier };

// ============================================================================
// Deal Score v2 — Exact Formula Weights & Thresholds
// ============================================================================
export const W_ATL = 40;
export const ATL_MATCH_BASE = 36;
export const ATL_BEAT_BONUS_MAX = 4;
export const ATL_BEAT_FULL_UNDERCUT_RATIO = 0.20;
export const W_DISCOUNT = 30;
export const W_HISTORY = 20;
export const W_MARKET = 10;
export const MAX_REALISTIC_DISCOUNT_PCT = 75;
export const FAKE_BASELINE_RATIO = 1.5;
/**
 * v2.4.0 (ADR-3): dampening factor applied to S_disc when a price is at or
 * above the game's OWN typical_sale_median — i.e. an ordinary, expected sale
 * price for THIS specific title, not a genuinely notable one.
 *
 * Validated on 15 real games (Indie/AA/AAA, 15-80EUR MSRP, 2026-09-14 export):
 * the previous MSRP-only formula gave 10.6-23.3 of 30 points at a game's own
 * median price, with a clear NEGATIVE correlation to that game's
 * median/MSRP ratio (the "cheaper culture" a game has, the more it was
 * over-rewarded for merely reaching its normal price). 0.35 was chosen to
 * bring that baseline down to a modest 3.7-8.2 points across the same
 * sample, while leaving genuinely-below-median prices at full strength.
 *
 * DECISION (v2.4.0, confirmed by product owner): shipped as-is despite a
 * large full-catalog impact — validated on all 1096 currently best-dealt
 * games in the live DB, 68.4% see a tier change (overwhelmingly downward,
 * e.g. Exceptional->Great, Great->Fair), because most currently-tracked
 * "best deals" sit close to each game's own routine sale price. This is
 * the intended, honest correction, not a bug — accepted knowingly.
 * Re-validate against tests/unit/dealScore.test.ts before changing further.
 */
export const OWN_MEDIAN_DAMPING_FACTOR = 0.35;
export const SINGLE_OFFER_MARKET_SCORE = 5;
export const NO_HISTORY_CAP = 40;
export const PROVISIONAL_CAP = 65;
export const PROVISIONAL_DEEP_CAP = 80;
export const STALE_CAP = 50;
export const DATA_SUFFICIENCY_MIN_SAMPLES = 3;

// Aliases for backward compatibility
export const NO_HISTORY_FALLBACK_CAP = NO_HISTORY_CAP;
export const PROVISIONAL_SCORE_CAP = PROVISIONAL_CAP;
export const PROVISIONAL_DEEP_DISCOUNT_CAP = PROVISIONAL_DEEP_CAP;
/** @deprecated Preserved for backward test compatibility */
export const RECORD_BONUS_MAX = 35;
/** @deprecated Preserved for backward test compatibility */
export const LOGISTIC_STEEPNESS = 1.2;
/** @deprecated Preserved for backward test compatibility */
export const BASE_SCORE_CEILING = 65;
/** @deprecated Preserved for backward test compatibility */
export const MIN_SCALE_PCT_OF_MEDIAN = 0.08;
/** @deprecated Preserved for backward test compatibility */
export const ABSOLUTE_MIN_SCALE_EUR = 0.30;
