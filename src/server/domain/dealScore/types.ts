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
