import { describe, it, expect } from 'vitest';
import { detectPriceEvent } from '../../src/server/domain/pricingError/priceEvents.js';
import { DEFAULT_PRICE_DROP_THRESHOLDS } from '../../src/server/domain/constants.js';

describe('Price Drop Threshold Boundaries & Precedence Verification', () => {
  describe('1. Micro-fluctuation & Noise Suppression', () => {
    it('suppresses micro-drops <= 0.015 EUR as noise', () => {
      // 0.01 EUR drop on 20 EUR
      expect(detectPriceEvent({
        currentPriceEur: 19.99,
        previousPriceEur: 20.00,
        historicalLowEur: 15.00,
      })).toBe('NONE');

      // Exactly 0.015 EUR drop on 10 EUR
      expect(detectPriceEvent({
        currentPriceEur: 9.985,
        previousPriceEur: 10.00,
        historicalLowEur: 8.00,
      })).toBe('NONE');
    });

    it('suppresses drops < 0.05 EUR with < 5% movement', () => {
      // 0.02 EUR drop on 20 EUR (0.1% drop)
      expect(detectPriceEvent({
        currentPriceEur: 19.98,
        previousPriceEur: 20.00,
        historicalLowEur: 15.00,
      })).toBe('NONE');

      // 0.04 EUR drop on 20 EUR (0.2% drop)
      expect(detectPriceEvent({
        currentPriceEur: 19.96,
        previousPriceEur: 20.00,
        historicalLowEur: 15.00,
      })).toBe('NONE');
    });

    it('suppresses low-price noise <= 0.10 EUR with < 5% movement on sub-5 EUR games', () => {
      // 0.08 EUR drop on 4.00 EUR (2% drop < 5%)
      expect(detectPriceEvent({
        currentPriceEur: 3.92,
        previousPriceEur: 4.00,
        historicalLowEur: 3.00,
      })).toBe('NONE');
    });
  });

  describe('2. Minor Fluctuations Below Moderate Threshold (< 10% or < 0.50 EUR)', () => {
    it('treats price drops < 10% as ordinary fluctuations (NONE)', () => {
      // 5% drop on 10 EUR (0.50 EUR drop, but < 10% moderate threshold)
      expect(detectPriceEvent({
        currentPriceEur: 9.50,
        previousPriceEur: 10.00,
        historicalLowEur: 7.00,
      })).toBe('NONE');

      // 9% drop on 20 EUR (1.80 EUR drop, but < 10% moderate threshold and < 3.00 EUR absolute)
      expect(detectPriceEvent({
        currentPriceEur: 18.20,
        previousPriceEur: 20.00,
        historicalLowEur: 12.00,
      })).toBe('NONE');
    });
  });

  describe('3. Moderate Drop Classification (>= 10% and >= 0.50 EUR)', () => {
    it('classifies drops meeting moderate percentage and minimum EUR', () => {
      // 10% drop on 10 EUR (1.00 EUR drop >= 0.50 EUR)
      expect(detectPriceEvent({
        currentPriceEur: 9.00,
        previousPriceEur: 10.00,
        historicalLowEur: 6.00,
      })).toBe('MODERATE_DROP');

      // 14% drop on 20 EUR (2.80 EUR drop)
      expect(detectPriceEvent({
        currentPriceEur: 17.20,
        previousPriceEur: 20.00,
        historicalLowEur: 12.00,
      })).toBe('MODERATE_DROP');
    });
  });

  describe('4. Significant Drop Classification (>= 15% & >= 0.75 EUR OR >= 3.00 EUR)', () => {
    it('classifies drops meeting significant percentage criteria', () => {
      // 15% drop on 10 EUR (1.50 EUR drop >= 0.75 EUR)
      expect(detectPriceEvent({
        currentPriceEur: 8.50,
        previousPriceEur: 10.00,
        historicalLowEur: 5.00,
      })).toBe('SIGNIFICANT_DROP');
    });

    it('classifies drops meeting absolute 3.00 EUR drop criteria', () => {
      // 3.50 EUR drop on 50 EUR (7% drop, but >= 3.00 EUR absolute)
      expect(detectPriceEvent({
        currentPriceEur: 46.50,
        previousPriceEur: 50.00,
        historicalLowEur: 35.00,
      })).toBe('SIGNIFICANT_DROP');
    });
  });

  describe('5. Major Drop Classification (>= 25% & >= 1.00 EUR OR >= 5.00 EUR)', () => {
    it('classifies drops meeting major percentage criteria', () => {
      // 25% drop on 20 EUR (5.00 EUR drop >= 1.00 EUR)
      expect(detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 20.00,
        historicalLowEur: 10.00,
      })).toBe('MAJOR_DROP');
    });

    it('classifies drops meeting absolute 5.00 EUR drop criteria', () => {
      // 5.50 EUR drop on 45 EUR (12.2% drop, but >= 5.00 EUR absolute)
      expect(detectPriceEvent({
        currentPriceEur: 39.50,
        previousPriceEur: 45.00,
        historicalLowEur: 30.00,
      })).toBe('MAJOR_DROP');
    });
  });

  describe('6. Extreme Drop Classification (>= 50% & >= 2.00 EUR OR >= 10.00 EUR)', () => {
    it('classifies drops meeting extreme percentage criteria', () => {
      // 50% drop on 20 EUR (10.00 EUR drop >= 2.00 EUR)
      expect(detectPriceEvent({
        currentPriceEur: 10.00,
        previousPriceEur: 20.00,
        historicalLowEur: 8.00,
      })).toBe('EXTREME_DROP');
    });

    it('classifies drops meeting absolute 10.00 EUR drop criteria', () => {
      // 12.00 EUR drop on 60 EUR (20% drop, but >= 10.00 EUR absolute)
      expect(detectPriceEvent({
        currentPriceEur: 48.00,
        previousPriceEur: 60.00,
        historicalLowEur: 35.00,
      })).toBe('EXTREME_DROP');
    });
  });

  describe('7. All-Time Low (ATL) Precedence & Confirmation', () => {
    it('grants RECORD_DROP for official store beating existing ATL', () => {
      expect(detectPriceEvent({
        currentPriceEur: 4.99,
        previousPriceEur: 8.00,
        historicalLowEur: 6.00,
        isOfficialMerchant: true,
      })).toBe('RECORD_DROP');
    });

    it('grants UNCONFIRMED_RECORD_DROP for single keyshop beating existing ATL', () => {
      expect(detectPriceEvent({
        currentPriceEur: 4.50,
        previousPriceEur: 8.00,
        historicalLowEur: 6.00,
        isOfficialMerchant: false,
        independentMerchantCount: 1,
        sourceAgreementCount: 1,
      })).toBe('UNCONFIRMED_RECORD_DROP');
    });

    it('grants RECORD_DROP for confirmed keyshop beating ATL (multi-merchant agreement)', () => {
      expect(detectPriceEvent({
        currentPriceEur: 4.50,
        previousPriceEur: 8.00,
        historicalLowEur: 6.00,
        isOfficialMerchant: false,
        independentMerchantCount: 2,
        sourceAgreementCount: 1,
      })).toBe('RECORD_DROP');
    });

    it('preserves ATL drop even on first observation without prior stream price', () => {
      expect(detectPriceEvent({
        currentPriceEur: 4.00,
        previousPriceEur: null,
        historicalLowEur: 6.00,
        isOfficialMerchant: true,
      })).toBe('RECORD_DROP');
    });
  });

  describe('8. First-Time Discovery (NEW_OFFER)', () => {
    it('classifies initial non-ATL observation as NEW_OFFER, never MAJOR_DROP or EXTREME_DROP', () => {
      expect(detectPriceEvent({
        currentPriceEur: 14.99,
        previousPriceEur: null,
        historicalLowEur: 10.00,
        isOfficialMerchant: true,
      })).toBe('NEW_OFFER');

      expect(detectPriceEvent({
        currentPriceEur: 2.99,
        previousPriceEur: undefined,
        historicalLowEur: 1.99,
        isOfficialMerchant: false,
      })).toBe('NEW_OFFER');
    });
  });

  describe('9. Directional Integrity (Increases, Invariance, Pricing Errors)', () => {
    it('classifies price increases as PRICE_INCREASE', () => {
      expect(detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 10.00,
        historicalLowEur: 8.00,
      })).toBe('PRICE_INCREASE');
    });

    it('classifies identical prices as NONE', () => {
      expect(detectPriceEvent({
        currentPriceEur: 19.99,
        previousPriceEur: 19.99,
        historicalLowEur: 15.00,
      })).toBe('NONE');
    });

    it('prioritizes PRICING_ERROR over any drop magnitude', () => {
      expect(detectPriceEvent({
        currentPriceEur: 0.99,
        previousPriceEur: 60.00,
        historicalLowEur: 20.00,
      }, true)).toBe('PRICING_ERROR');
    });
  });

  describe('10. Custom Threshold Overrides', () => {
    it('respects caller-supplied threshold overrides', () => {
      // Standard: 30% drop on 10 EUR is 3.00 EUR drop -> MAJOR_DROP (>= 25% and >= 1.00 EUR, or >= 5.00 EUR absolute)
      expect(detectPriceEvent({
        currentPriceEur: 7.00,
        previousPriceEur: 10.00,
        historicalLowEur: 5.00,
      })).toBe('MAJOR_DROP');

      // Custom override: raise MAJOR_DROP_PERCENT to 40% (and keeping 5 EUR absolute)
      // 30% drop is < 40% and 3.00 EUR is < 5.00 EUR -> falls through to SIGNIFICANT_DROP
      expect(detectPriceEvent({
        currentPriceEur: 7.00,
        previousPriceEur: 10.00,
        historicalLowEur: 5.00,
      }, false, {
        MAJOR_DROP_PERCENT: 40.0,
      })).toBe('SIGNIFICANT_DROP');
    });
  });
});
