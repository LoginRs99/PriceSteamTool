import { describe, it, expect } from 'vitest';
import { evaluateOfferAnomaly } from '../../src/server/domain/anomaly.js';

describe('Anomaly Detection Engine — Comprehensive Audit Suite', () => {
  it('does not flag legitimate deep discounts on verified official stores', () => {
    const res = evaluateOfferAnomaly({
      priceEur: 14.99,
      basePriceEur: 59.99,
      originalPriceEur: 59.99,
      isOfficial: true,
      otherPrices: [14.99, 19.99, 24.99, 59.99]
    });

    expect(res.isAnomaly).toBe(false);
    expect(res.score).toBe(0.0);
  });

  it('does NOT flag legitimate new historical lows as errors', () => {
    // Previous historical low was €19.99, new deal is €14.50
    const res = evaluateOfferAnomaly({
      priceEur: 14.50,
      basePriceEur: 59.99,
      historicalLowEur: 19.99,
      isOfficial: true,
      otherPrices: [14.50, 16.00, 18.00]
    });

    expect(res.isAnomaly).toBe(false);
  });

  it('flags extreme sub-euro price on high-MSRP title from unofficial keyshop', () => {
    const res = evaluateOfferAnomaly({
      priceEur: 0.79,
      basePriceEur: 59.99,
      isOfficial: false,
      otherPrices: [59.99, 49.99, 45.00]
    });

    expect(res.isAnomaly).toBe(true);
    expect(res.score).toBeGreaterThan(0.7);
    expect(res.type).toBe('EXTREME_DISCOUNT');
    expect(res.reason).toContain('Suspiciously low');
  });

  it('flags severe market median discrepancy', () => {
    // Median is ~€40, unverified listing is €3.50
    const res = evaluateOfferAnomaly({
      priceEur: 3.50,
      basePriceEur: 49.99,
      isOfficial: false,
      otherPrices: [39.99, 38.50, 42.00, 40.00]
    });

    expect(res.isAnomaly).toBe(true);
    expect(res.type).toBe('UNVERIFIED_MERCHANT_DISCREPANCY');
    expect(res.reason).toContain('median');
  });
});
