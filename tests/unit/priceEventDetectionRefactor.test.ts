import { describe, it, expect } from 'vitest';
import { detectPriceEvent, DEFAULT_PRICE_DROP_THRESHOLDS } from '../../src/server/domain/pricingError/priceEvents.js';

describe('Price Event Detection Refactor Suite', () => {
  describe('1. First-time observations', () => {
    it('classifies first-time observation (no previousPriceEur) as NEW_OFFER', () => {
      const event = detectPriceEvent({
        currentPriceEur: 14.99,
        basePriceEur: 59.99,
        historicalLowEur: 10.00
      });
      expect(event).toBe('NEW_OFFER');
    });

    it('classifies first-time observation with undefined previousPriceEur as NEW_OFFER', () => {
      const event = detectPriceEvent({
        currentPriceEur: 9.99,
        previousPriceEur: undefined,
        basePriceEur: 39.99
      });
      expect(event).toBe('NEW_OFFER');
    });

    it('classifies first-time observation with 0 previousPriceEur as NEW_OFFER', () => {
      const event = detectPriceEvent({
        currentPriceEur: 19.99,
        previousPriceEur: 0,
        basePriceEur: 49.99
      });
      expect(event).toBe('NEW_OFFER');
    });

    it('classifies first-time observation even with massive discount as NEW_OFFER, never MAJOR_DROP or EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 4.99,
        basePriceEur: 69.99,
        historicalLowEur: 4.99,
        isOfficialMerchant: true
      });
      expect(event).toBe('NEW_OFFER');
    });
  });

  describe('2. Noise floor and micro-fluctuation suppression', () => {
    it('suppresses micro-drop <= 0.015 EUR as NONE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 12.08,
        previousPriceEur: 12.09, // -0.01€
        basePriceEur: 39.99
      });
      expect(event).toBe('NONE');
    });

    it('suppresses 5¢ keyshop noise with < 5% movement as NONE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 29.96,
        previousPriceEur: 30.00, // -0.04€ (0.13%)
        basePriceEur: 59.99
      });
      expect(event).toBe('NONE');
    });

    it('suppresses 8¢ keyshop noise with < 5% movement as NONE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 24.92,
        previousPriceEur: 25.00, // -0.08€ (0.32%)
        basePriceEur: 49.99
      });
      expect(event).toBe('NONE');
    });

    it('suppresses cheap game micro-drop (0.89€ -> 0.79€, 11% but only 0.10€ savings) as NONE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 0.79,
        previousPriceEur: 0.89, // -0.10€ on a sub-5€ game
        basePriceEur: 4.99
      });
      expect(event).toBe('NONE');
    });

    it('suppresses 0€ change (same price) as NONE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 15.00,
        basePriceEur: 30.00
      });
      expect(event).toBe('NONE');
    });
  });

  describe('3. Calibrated Drop Magnitude Classifications', () => {
    it('evaluates MODERATE_DROP: >= 10% drop and >= 0.50€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 9.00,
        previousPriceEur: 10.00, // 10% drop, 1.00€ savings
        basePriceEur: 20.00
      });
      expect(event).toBe('MODERATE_DROP');
    });

    it('does NOT award MODERATE_DROP if percentage >= 10% but savings < 0.50€', () => {
      const event = detectPriceEvent({
        currentPriceEur: 2.70,
        previousPriceEur: 3.00, // 10% drop, but only 0.30€ savings (< 0.50€)
        basePriceEur: 9.99
      });
      expect(event).toBe('NONE');
    });

    it('evaluates SIGNIFICANT_DROP: >= 15% drop and >= 0.75€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 8.50,
        previousPriceEur: 10.00, // 15% drop, 1.50€ savings
        basePriceEur: 20.00
      });
      expect(event).toBe('SIGNIFICANT_DROP');
    });

    it('evaluates SIGNIFICANT_DROP via absolute drop: >= 3.00€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 26.50,
        previousPriceEur: 30.00, // 11.67% drop, but 3.50€ savings (>= 3.00€)
        basePriceEur: 40.00
      });
      expect(event).toBe('SIGNIFICANT_DROP');
    });

    it('evaluates MAJOR_DROP: >= 25% drop and >= 1.00€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 20.00, // 25% drop, 5.00€ savings
        basePriceEur: 40.00
      });
      expect(event).toBe('MAJOR_DROP');
    });

    it('evaluates MAJOR_DROP via absolute drop: >= 5.00€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 44.00,
        previousPriceEur: 50.00, // 12% drop, but 6.00€ savings (>= 5.00€)
        basePriceEur: 60.00
      });
      expect(event).toBe('MAJOR_DROP');
    });

    it('evaluates EXTREME_DROP: >= 75% drop and >= 2.00€ savings', () => {
      const event = detectPriceEvent({
        currentPriceEur: 5.00,
        previousPriceEur: 20.00, // 75% drop, 15.00€ savings
        basePriceEur: 40.00
      });
      expect(event).toBe('EXTREME_DROP');
    });

    it('evaluates EXTREME_DROP via absolute drop: >= 15.00€ savings with relative >= 35%', () => {
      const event = detectPriceEvent({
        currentPriceEur: 42.00,
        previousPriceEur: 70.00, // 40% drop, 28.00€ savings (>= 15.00€ and >= 35%)
        basePriceEur: 80.00
      });
      expect(event).toBe('EXTREME_DROP');
    });
  });

  describe('4. Historical Low Record Drops', () => {
    it('classifies genuine ATL drop from official store as RECORD_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 7.50,
        previousPriceEur: 12.00,
        basePriceEur: 29.99,
        historicalLowEur: 8.00, // 7.50 < 8.00 * 0.98 = 7.84
        isOfficialMerchant: true
      });
      expect(event).toBe('RECORD_DROP');
    });

    it('classifies genuine ATL drop from unconfirmed single keyshop as UNCONFIRMED_RECORD_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 7.50,
        previousPriceEur: 12.00,
        basePriceEur: 29.99,
        historicalLowEur: 8.00,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        independentMerchantCount: 1
      });
      expect(event).toBe('UNCONFIRMED_RECORD_DROP');
    });

    it('does NOT award record drop if price is within 2% of ATL (not strictly beating by >2%)', () => {
      const event = detectPriceEvent({
        currentPriceEur: 7.90,
        previousPriceEur: 8.00, // drop of 0.10€, but not >2% below ATL 8.00 (threshold 7.84)
        basePriceEur: 29.99,
        historicalLowEur: 8.00,
        isOfficialMerchant: true
      });
      expect(event).not.toBe('RECORD_DROP');
      expect(event).not.toBe('UNCONFIRMED_RECORD_DROP');
    });
  });

  describe('5. Directional and Anomaly Handling', () => {
    it('classifies price increase as PRICE_INCREASE', () => {
      const event = detectPriceEvent({
        currentPriceEur: 18.00,
        previousPriceEur: 12.00,
        basePriceEur: 30.00
      });
      expect(event).toBe('PRICE_INCREASE');
    });

    it('preserves PRICING_ERROR when flagged by detector regardless of drop', () => {
      const event = detectPriceEvent({
        currentPriceEur: 0.99,
        previousPriceEur: 59.99,
        basePriceEur: 59.99
      }, true);
      expect(event).toBe('PRICING_ERROR');
    });
  });

  describe('6. Configurable Thresholds Override', () => {
    it('allows custom threshold override without altering defaults', () => {
      // With custom major drop threshold requiring 40% instead of 25%:
      const eventDefault = detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 20.00 // 25% drop, 5.00€
      });
      expect(eventDefault).toBe('MAJOR_DROP');

      const eventCustom = detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 20.00
      }, false, {
        MAJOR_DROP_PERCENT: 40.0,
        MAJOR_DROP_ABSOLUTE_EUR: 8.00
      });
      // 25% < 40% and 5€ < 8€, so custom falls back to SIGNIFICANT_DROP
      expect(eventCustom).toBe('SIGNIFICANT_DROP');
    });
  });
});
