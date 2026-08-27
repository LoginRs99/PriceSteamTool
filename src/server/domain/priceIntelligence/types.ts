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
