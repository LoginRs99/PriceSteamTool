import { describe, it, expect, beforeEach } from 'vitest';
import { exchangeRateService } from '../../src/server/domain/exchangeRate.js';
import { calculateDealScore } from '../../src/server/domain/dealScore/calculator.js';
import { calculateTypicalSalePrice } from '../../src/server/domain/priceIntelligence/typicalSale.js';
import { evaluatePurchaseAdvice } from '../../src/server/domain/priceIntelligence/purchaseAdvice.js';

describe('Strategic Features & Bugfix Regression Suite', () => {
  describe('Multi-Currency & HUF Support', () => {
    it('recognizes HUF and Hungarian Ft symbol', () => {
      expect(exchangeRateService.normalizeCurrencyCode('HUF')).toBe('HUF');
      expect(exchangeRateService.normalizeCurrencyCode('Ft')).toBe('HUF');
      expect(exchangeRateService.normalizeCurrencyCode('ft')).toBe('HUF');
      expect(exchangeRateService.normalizeCurrencyCode('FT')).toBe('HUF');
    });

    it('converts between EUR and HUF using realistic rate (~395-400)', () => {
      const eurVal = 10;
      const hufVal = exchangeRateService.convertFromEur(eurVal, 'HUF');
      expect(hufVal).toBeGreaterThan(3000);
      expect(hufVal).toBeLessThan(5000);

      const convertedBackEur = exchangeRateService.convertToEur(hufVal, 'HUF');
      expect(Math.abs(convertedBackEur - eurVal)).toBeLessThanOrEqual(0.1);
    });

    it('returns currency dictionary from getRatesFromEur', () => {
      const rates = exchangeRateService.getRatesFromEur();
      expect(rates.EUR).toBe(1.0);
      expect(rates.HUF).toBeDefined();
      expect(rates.USD).toBeDefined();
      expect(rates.GBP).toBeDefined();
      expect(rates.CAD).toBeDefined();
      expect(rates.AUD).toBeDefined();
    });
  });

  describe('Mathematical DealScore & IQR Boundaries', () => {
    it('defends against NaN or negative priceEur inputs gracefully', () => {
      const nanResult = calculateDealScore({ priceEur: NaN });
      expect(nanResult.score).toBe(0);
      expect(nanResult.verdict).toBe('WAIT');

      const negResult = calculateDealScore({ priceEur: -5.0 });
      expect(negResult.score).toBe(0);
      expect(negResult.verdict).toBe('WAIT');
    });

    it('filters both extreme high and extreme low outliers with bidirectional Tukey fence', () => {
      // 10 normal sales around 10-15 EUR, one glitch 1 EUR and one outlier bundle 100 EUR
      const history = [
        { priceEur: 1, discountPercent: 90, recordedAt: '2026-01-01', isTrustedSource: true },
        { priceEur: 10, discountPercent: 50, recordedAt: '2026-01-02', isTrustedSource: true },
        { priceEur: 11, discountPercent: 45, recordedAt: '2026-01-03', isTrustedSource: true },
        { priceEur: 12, discountPercent: 40, recordedAt: '2026-01-04', isTrustedSource: true },
        { priceEur: 12, discountPercent: 40, recordedAt: '2026-01-05', isTrustedSource: true },
        { priceEur: 13, discountPercent: 35, recordedAt: '2026-01-06', isTrustedSource: true },
        { priceEur: 14, discountPercent: 30, recordedAt: '2026-01-07', isTrustedSource: true },
        { priceEur: 14, discountPercent: 30, recordedAt: '2026-01-08', isTrustedSource: true },
        { priceEur: 15, discountPercent: 25, recordedAt: '2026-01-09', isTrustedSource: true },
        { priceEur: 15, discountPercent: 25, recordedAt: '2026-01-10', isTrustedSource: true },
        { priceEur: 100, discountPercent: 20, recordedAt: '2026-01-11', isTrustedSource: true }
      ];
      const result = calculateTypicalSalePrice(20, history as any);
      expect(result.isLowConfidence).toBe(false);
      // Glitch 1 and outlier 100 should be excluded from final pool
      expect(result.medianPriceEur).toBeGreaterThan(10);
      expect(result.medianPriceEur).toBeLessThan(20);
    });

    it('correctly gates purchase advice when current price has never dropped below MSRP', () => {
      const advice = evaluatePurchaseAdvice(
        { id: '1', title: 'Test Game', bestPriceEur: 59.99, basePriceEur: 59.99, bestDiscountPercent: 0 } as any,
        undefined,
        {
          low7d: { priceEur: null, isExactPeriodData: false, observationCount: 0 },
          low30d: { priceEur: null, isExactPeriodData: false, observationCount: 0 },
          low90d: { priceEur: null, isExactPeriodData: false, observationCount: 0 },
          low1y: { priceEur: null, isExactPeriodData: false, observationCount: 0 },
          allTimeLow: { priceEur: 59.99, isConfirmed: false, source: 'Steam' }
        },
        { medianPriceEur: null, sampleCount: 0, isLowConfidence: true },
        undefined,
        1
      );

      expect(advice.decision).toBe('WAIT');
      expect(advice.headline).toBe('Insufficient Price History');
    });
  });
});
