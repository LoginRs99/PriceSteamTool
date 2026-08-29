/**
 * Canonical domain constants shared across server-side modules.
 *
 * IMPORTANT: Any SQL query that encodes a 72-hour freshness window as a raw numeric literal
 * (e.g. "julianday(...) * 24 <= 72") must be kept in sync with FRESHNESS_WINDOW_MS manually,
 * since SQL strings cannot import a JS constant at runtime.
 */

/** Offer freshness window: an offer observed within this many milliseconds is considered "fresh". */
export const FRESHNESS_WINDOW_MS = 72 * 60 * 60 * 1000;
