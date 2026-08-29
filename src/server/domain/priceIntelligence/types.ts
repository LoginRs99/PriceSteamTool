import type { Game, Offer, PriceHistoryEntry } from '../../../shared/types.js';

export interface PriceIntelligenceInput {
  game: Game;
  offers: Offer[];
  history: PriceHistoryEntry[];
}

/**
 * Validates whether a historical price observation is trusted for statistical analysis.
 * Excludes anomalous, high-risk, or glitch observations from corrupting analytical baselines (ATL, Typical Sale, Volatility).
 */
export function isTrustedHistoryEntry(entry: PriceHistoryEntry): boolean {
  if (!entry || typeof entry.priceEur !== 'number' || isNaN(entry.priceEur) || entry.priceEur <= 0) {
    return false;
  }
  if (entry.isAnomaly === true) {
    return false;
  }
  if (entry.riskLevel === 'HIGH') {
    return false;
  }
  if (entry.priceEvent === 'EXTREME_DROP') {
    if (entry.priceEur < 1.00) return false;
  }
  return true;
}

export function isKeyshopSourceStr(source?: string): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return (
    s.includes('allkeyshop') ||
    s.includes('kinguin') ||
    s.includes('g2a') ||
    s.includes('eneba') ||
    s.includes('gamivo') ||
    s.includes('cdkeys') ||
    s.includes('keyshop') ||
    s.includes('marketplace') ||
    s.includes('k4g') ||
    s.includes('driffle') ||
    s.includes('instant-gaming')
  );
}

/**
 * Returns true only for direct official storefronts (the seller IS the platform).
 * The Steam store is the only source in this codebase that qualifies.
 * Source values that reach here: SourceCode 'steam', free-text 'Steam', 'Steam Store'.
 */
export function isOfficialStoreSource(source?: string): boolean {
  if (!source) return false;
  const s = source.toLowerCase().trim();
  // Match the SourceCode 'steam' and any free-text variants written by callers
  return s === 'steam' || s === 'steam store' || s.startsWith('steam store');
}

/**
 * Returns true for price aggregators that surface third-party storefront prices
 * but are NOT the direct seller (CheapShark, ITAD, GG.deals).
 * An aggregator-sourced ATL is NOT confirmed on its own — it requires corroboration.
 * Source values: SourceCode 'cheapshark'/'itad'/'ggdeals', free-text 'CheapShark',
 *   'ITAD (...)', 'GG.deals (Official)', etc.
 */
export function isAggregatorSource(source?: string): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return (
    s === 'cheapshark' ||
    s.startsWith('cheapshark') ||
    s === 'itad' ||
    s.startsWith('itad') ||
    s === 'ggdeals' ||
    s.startsWith('ggdeals') ||
    s.startsWith('gg.deals')
  );
}
