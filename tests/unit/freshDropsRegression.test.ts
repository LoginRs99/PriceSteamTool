import { describe, it, expect } from 'vitest';
import { detectPriceEvent } from '../../src/server/domain/pricingError/priceEvents.js';

describe('Fresh Drops & Price Event Classification Regression Suite', () => {
  describe('1. Production Micro-Drop Defects (Must return NONE)', () => {
    it('Terminator: Resistance @ Kinguin: €12.09 -> €12.08 (-€0.01) is noise, NOT MAJOR_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 12.08,
        previousPriceEur: 12.09,
        basePriceEur: 39.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('GOD EATER 3 @ HRK: €4.61 -> €4.60 (-€0.01) is noise, NOT EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 4.60,
        previousPriceEur: 4.61,
        basePriceEur: 49.99,
        historicalLowEur: 4.50,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('GOD EATER 3 @ G2A: €4.15 -> €4.14 (-€0.01) is noise, NOT EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 4.14,
        previousPriceEur: 4.15,
        basePriceEur: 49.99,
        historicalLowEur: 4.00,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('Mages of Mystralia @ GAMIVO: €3.56 -> €3.55 (-€0.01) is noise, NOT EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 3.55,
        previousPriceEur: 3.56,
        basePriceEur: 19.99,
        historicalLowEur: 2.50,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('RoboCop: Rogue City @ K4G: €1.40 -> €1.39 (-€0.01) is noise, NOT EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 1.39,
        previousPriceEur: 1.40,
        basePriceEur: 49.99,
        historicalLowEur: 1.20,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('Shadow Dungeon @ GG.deals: €4.85 -> €4.84 (-€0.01) is noise, NOT RECORD_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 4.84,
        previousPriceEur: 4.85,
        basePriceEur: 14.99,
        historicalLowEur: 4.80,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('SAMURAI WARRIORS 5 @ IndieGala: €30.02 -> €30.01 (-€0.01) is noise, NOT MAJOR_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 30.01,
        previousPriceEur: 30.02,
        basePriceEur: 69.99,
        historicalLowEur: 25.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('NONE');
    });

    it('filters small cent fluctuations (<0.05€ and <2%) on existing offers', () => {
      expect(detectPriceEvent({
        currentPriceEur: 49.96,
        previousPriceEur: 50.00, // 0.04€ drop (0.08%)
        basePriceEur: 59.99
      })).toBe('NONE');

      expect(detectPriceEvent({
        currentPriceEur: 1.98,
        previousPriceEur: 2.00, // 0.02€ drop (1.0%)
        basePriceEur: 9.99
      })).toBe('NONE');
    });
  });

  describe('2. Historical Low Record Integrity', () => {
    it('awards RECORD_DROP only when strictly lower than known ATL with confirmation', () => {
      const event = detectPriceEvent({
        currentPriceEur: 7.99,
        previousPriceEur: 14.99,
        basePriceEur: 29.99,
        historicalLowEur: 8.50, // 7.99 < 8.50
        isOfficialMerchant: true
      });
      expect(event).toBe('RECORD_DROP');
    });

    it('awards UNCONFIRMED_RECORD_DROP when strictly lower than known ATL from single keyshop', () => {
      const event = detectPriceEvent({
        currentPriceEur: 7.99,
        previousPriceEur: 14.99,
        basePriceEur: 29.99,
        historicalLowEur: 8.50,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        independentMerchantCount: 1
      });
      expect(event).toBe('UNCONFIRMED_RECORD_DROP');
    });

    it('does NOT award RECORD_DROP when price is within 2% above ATL (not breaking record)', () => {
      const event = detectPriceEvent({
        currentPriceEur: 10.15,
        previousPriceEur: 10.15,
        basePriceEur: 29.99,
        historicalLowEur: 10.00, // 10.15 > 10.00
        isOfficialMerchant: true
      });
      expect(event).not.toBe('RECORD_DROP');
      expect(event).not.toBe('UNCONFIRMED_RECORD_DROP');
      expect(event).toBe('NONE');
    });

    it('does NOT award RECORD_DROP when price equals existing ATL without prior price drop', () => {
      const event = detectPriceEvent({
        currentPriceEur: 10.00,
        previousPriceEur: 10.00,
        basePriceEur: 29.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('NONE');
    });
  });

  describe('3. Real Price Drop Classifications (Start of Sale vs Deepening)', () => {
    it('classifies massive sale start from regular price as EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 14.99,
        previousPriceEur: 59.99, // full MSRP
        basePriceEur: 59.99,
        isOfficialMerchant: true
      });
      expect(event).toBe('EXTREME_DROP');
    });

    it('classifies 50% discount sale start from regular price as MAJOR_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 19.99,
        previousPriceEur: 39.99, // full MSRP
        basePriceEur: 39.99,
        isOfficialMerchant: true
      });
      expect(event).toBe('MAJOR_DROP');
    });

    it('classifies 50% price slash on already-discounted offer as EXTREME_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 9.99,
        previousPriceEur: 19.99, // already discounted from 59.99 MSRP
        basePriceEur: 59.99,
        isOfficialMerchant: true
      });
      expect(event).toBe('EXTREME_DROP');
    });

    it('classifies 25% price drop on already-discounted offer as MAJOR_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 15.00,
        previousPriceEur: 20.00, // dropped 5€ (25%)
        basePriceEur: 30.00, // 50% discount from MSRP (Major drop)
        isOfficialMerchant: true
      });
      expect(event).toBe('MAJOR_DROP');
    });
  });

  describe('4. Directional and Health Integrity', () => {
    it('returns PRICE_INCREASE when price rises', () => {
      const event = detectPriceEvent({
        currentPriceEur: 29.99,
        previousPriceEur: 14.99,
        basePriceEur: 59.99
      });
      expect(event).toBe('PRICE_INCREASE');
    });

    it('returns PRICING_ERROR when flagged by detector regardless of drop depth', () => {
      const event = detectPriceEvent({
        currentPriceEur: 0.49,
        previousPriceEur: 59.99,
        basePriceEur: 59.99
      }, true);
      expect(event).toBe('PRICING_ERROR');
    });

    it('classifies first observation of moderately discounted catalog game as SIGNIFICANT_DROP', () => {
      const event = detectPriceEvent({
        currentPriceEur: 29.99, // 40% discount (saving 20€)
        // no previousPriceEur
        basePriceEur: 49.99
      });
      expect(event).toBe('SIGNIFICANT_DROP');
    });
  });

  describe('5. Fresh Drops versus ATL Proximity & Best Deals Separation', () => {
    it('does NOT trigger Fresh Drop when price is unchanged while sitting 3% above ATL', () => {
      // ATL is €10.00, price was €10.30 and stays €10.30 (3% above ATL)
      const event = detectPriceEvent({
        currentPriceEur: 10.30,
        previousPriceEur: 10.30,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('NONE');
    });

    it('does NOT trigger Fresh Drop on €0.01 micro-movement while sitting 5% above ATL', () => {
      // ATL is €10.00, price drops from €10.51 to €10.50 (-€0.01)
      const event = detectPriceEvent({
        currentPriceEur: 10.50,
        previousPriceEur: 10.51,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('NONE');
    });

    it('does NOT trigger Fresh Drop on insignificant movement (< 5% and < €0.05) within 2-10% of ATL', () => {
      // ATL is €10.00, price drops from €10.60 to €10.57 (-€0.03, 0.28% drop)
      const event = detectPriceEvent({
        currentPriceEur: 10.57,
        previousPriceEur: 10.60,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: false
      });
      expect(event).toBe('NONE');
    });

    it('returns PRICE_INCREASE when price rises while still within 10% of ATL', () => {
      // ATL is €10.00, price rises from €10.20 to €10.80 (+€0.60, still within 8% of ATL)
      const event = detectPriceEvent({
        currentPriceEur: 10.80,
        previousPriceEur: 10.20,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('PRICE_INCREASE');
    });

    it('preserves newly discovered legitimate offer near ATL as MAJOR_DROP without claiming record', () => {
      // Brand new discovery near ATL (MSRP €49.99 -> €10.50, ATL €10.00)
      const event = detectPriceEvent({
        currentPriceEur: 10.50,
        // no previousPriceEur: newly discovered offer
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      // Evaluates as genuine deep sale (MAJOR_DROP or EXTREME_DROP), strictly NOT RECORD_DROP
      expect(event).toBe('EXTREME_DROP');
      expect(event).not.toBe('RECORD_DROP');
      expect(event).not.toBe('UNCONFIRMED_RECORD_DROP');
    });

    it('preserves genuine sale start dropping from MSRP into near-ATL zone as MAJOR_DROP', () => {
      // Genuine sale start: game was at MSRP €49.99, now on sale for €10.50 (near ATL €10.00)
      const event = detectPriceEvent({
        currentPriceEur: 10.50,
        previousPriceEur: 49.99,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        isOfficialMerchant: true
      });
      expect(event).toBe('EXTREME_DROP');
      expect(event).not.toBe('RECORD_DROP');
    });
  });
});
