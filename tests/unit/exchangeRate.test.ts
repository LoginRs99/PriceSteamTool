import { describe, it, expect } from 'vitest';
import { exchangeRateService, FALLBACK_TO_EUR_RATES } from '../../src/server/domain/exchangeRate.js';
import { convertToEur } from '../../src/server/domain/normalizer.js';

describe('Exchange Rate Service & Currency Normalization', () => {
  it('normalizes common currency codes and symbols', () => {
    expect(exchangeRateService.normalizeCurrencyCode('EUR')).toBe('EUR');
    expect(exchangeRateService.normalizeCurrencyCode('€')).toBe('EUR');
    expect(exchangeRateService.normalizeCurrencyCode('$')).toBe('USD');
    expect(exchangeRateService.normalizeCurrencyCode('usd')).toBe('USD');
    expect(exchangeRateService.normalizeCurrencyCode('£')).toBe('GBP');
    expect(exchangeRateService.normalizeCurrencyCode('gbp')).toBe('GBP');
    expect(exchangeRateService.normalizeCurrencyCode('HUF')).toBe('HUF');
    expect(exchangeRateService.normalizeCurrencyCode('Ft')).toBe('HUF');
    expect(exchangeRateService.normalizeCurrencyCode('PLN')).toBe('PLN');
    expect(exchangeRateService.normalizeCurrencyCode('zł')).toBe('PLN');
  });

  it('correctly converts amounts in standard currencies to EUR', () => {
    // 100 EUR is 100 EUR
    expect(convertToEur(100, 'EUR')).toBe(100);
    expect(convertToEur(100, '€')).toBe(100);

    // 100 USD at 0.92 = 92 EUR
    expect(convertToEur(100, 'USD')).toBe(92);

    // 100 GBP at 1.17 = 117 EUR
    expect(convertToEur(100, 'GBP')).toBe(117);

    // 40,000 HUF at 0.0025 = 100 EUR
    expect(convertToEur(40000, 'HUF')).toBe(100);
  });

  it('handles invalid or zero amounts gracefully', () => {
    expect(convertToEur(0, 'EUR')).toBe(0);
    expect(convertToEur(-10, 'USD')).toBe(0);
    expect(convertToEur(NaN, 'GBP')).toBe(0);
  });

  it('allows setting custom or dynamic exchange rates', () => {
    exchangeRateService.setRate('TEST_CURR', 0.50);
    expect(convertToEur(100, 'TEST_CURR')).toBe(50);
  });
});
