import { describe, it, expect } from 'vitest';
import { 
  calculateDealScore, 
  calculateBaseScore,
  calculateRecordBonus,
  calculateDataConfidence,
  getDealScoreTier,
  getConfidenceTier,
  LOGISTIC_STEEPNESS,
  BASE_SCORE_CEILING,
  RECORD_BONUS_MAX,
  MIN_SCALE_PCT_OF_MEDIAN,
  ABSOLUTE_MIN_SCALE_EUR,
  NO_HISTORY_FALLBACK_CAP,
  DATA_SUFFICIENCY_MIN_SAMPLES,
  PROVISIONAL_SCORE_CAP
} from '../../src/server/domain/dealScore.js';

describe('Deal Score v2.2 (Pure Price Engine & Data Sufficiency Guard)', () => {
  // ----------------------------------------------------
  // 1. Stage 1: Base Score (Median & Volatility Normalization)
  // ----------------------------------------------------
  describe('Stage 1: Base Score & Adaptive Sigma Floor', () => {
    it('evaluates exact median price to dead center 32.5 base score', () => {
      // When price matches typical sale median, z = 0 -> 65 / (1 + exp(0)) = 32.5
      const res = calculateBaseScore(25.00, 25.00, 20.00, 30.00);
      expect(res.zScore).toBe(0);
      expect(res.baseScore).toBe(32.5);
    });

    it('evaluates scale floor consistently across price bands for 0-IQR games', () => {
      // €0.99 with 10c drop -> sigma_eff = max(0, 0.0792, 0.30) = 0.30 -> z = 0.10 / 0.30 = 0.333
      const res099 = calculateBaseScore(0.89, 0.99, undefined, undefined);
      expect(res099.effectiveSigma).toBe(0.30);
      expect(res099.zScore).toBe(0.333);
      expect(res099.baseScore).toBeGreaterThan(35);
      expect(res099.baseScore).toBeLessThan(45);

      // €19.99 with 2.00€ drop (10%) -> sigma_eff = 19.99 * 0.08 = 1.599 -> z = 2.00 / 1.599 = 1.251
      const res1999 = calculateBaseScore(17.99, 19.99, undefined, undefined);
      expect(res1999.effectiveSigma).toBeCloseTo(1.599, 2);
      expect(res1999.zScore).toBeCloseTo(1.251, 2);
      expect(res1999.baseScore).toBeGreaterThan(50);
      expect(res1999.baseScore).toBeLessThan(58);

      // €59.99 with 6.00€ drop (10%) -> sigma_eff = 59.99 * 0.08 = 4.799 -> z = 6.00 / 4.799 = 1.250
      const res5999 = calculateBaseScore(53.99, 59.99, undefined, undefined);
      expect(res5999.effectiveSigma).toBeCloseTo(4.799, 2);
      expect(res5999.zScore).toBeCloseTo(1.250, 2);
      expect(res5999.baseScore).toBeCloseTo(res1999.baseScore, 0); // Scale invariance for identical relative moves
    });

    it('computes realistic logistic S-curve for z from -3 to +3', () => {
      const median = 20;
      const sigma = 5;
      const q1 = median - (sigma * 1.349) / 2;
      const q3 = median + (sigma * 1.349) / 2;

      // z = 0 (price = 20) -> 32.5
      expect(calculateBaseScore(20, median, q1, q3).baseScore).toBe(32.5);
      // z = +1 (price = 15) -> ~50.0
      expect(calculateBaseScore(15, median, q1, q3).baseScore).toBeCloseTo(50.0, 0);
      // z = +2 (price = 10) -> ~59.6
      expect(calculateBaseScore(10, median, q1, q3).baseScore).toBeCloseTo(59.6, 0);
      // z = -1 (price = 25) -> ~15.1
      expect(calculateBaseScore(25, median, q1, q3).baseScore).toBeCloseTo(15.1, 0);
      // z = -3 (price = 35) -> < 3.0
      expect(calculateBaseScore(35, median, q1, q3).baseScore).toBeLessThan(3);
    });
  });

  // ----------------------------------------------------
  // 2. Stage 2: Continuous Relative Record Bonus
  // ----------------------------------------------------
  describe('Stage 2: Continuous Record Bonus', () => {
    const median = 25.00;
    const atl = 15.00;

    it('awards depth-scaled base points for matching ATL and full bonus for deep undercuts', () => {
      // ATL match: earns 20.0 points
      expect(calculateRecordBonus(15.00, median, atl).recordBonus).toBe(20.0);
      // Deep undercut (10€ vs 15€ ATL = 33% undercut >= 20%): earns full 35.0 points
      expect(calculateRecordBonus(10.00, median, atl).recordBonus).toBe(35.0);
    });

    it('is strictly continuous at ATL ± 1 cent without cliff jumps', () => {
      const bonusExact = calculateRecordBonus(15.00, median, atl).recordBonus;
      const bonusPlus1Cent = calculateRecordBonus(15.01, median, atl).recordBonus;
      
      expect(bonusExact).toBe(20.0);
      expect(bonusPlus1Cent).toBeCloseTo(19.96, 1);
      // Difference between ATL and ATL + 1c is less than 0.10 point
      expect(Math.abs(bonusExact - bonusPlus1Cent)).toBeLessThan(0.10);
    });

    it('smoothly decays to 0.0 as price reaches median', () => {
      expect(calculateRecordBonus(25.00, median, atl).recordBonus).toBe(0.0);
      expect(calculateRecordBonus(30.00, median, atl).recordBonus).toBe(0.0);
    });

    it('handles edge case where median <= ATL without division by zero', () => {
      const res = calculateRecordBonus(10.00, 10.00, 10.00);
      expect(res.recordBonus).toBe(0);
      const resAbove = calculateRecordBonus(10.50, 10.00, 10.00);
      expect(resAbove.recordBonus).toBe(0);
    });
  });

  // ----------------------------------------------------
  // 3. Data Sufficiency Guard & Confidence Model
  // ----------------------------------------------------
  describe('Data Sufficiency Guard & Confidence Engine', () => {
    it('applies provisional cap (65) when sample count is very sparse (N = 1 or 2)', () => {
      // Base 50€, 1 observation at 40€, price 25€, ATL 25€
      const res = calculateDealScore({
        priceEur: 25.00,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 40.00,
        allTimeLowEur: 25.00,
        sampleCount: 2 // N = 2
      });

      // Raw score would be 100, but Data Sufficiency Guard caps it at 65 (Good)
      expect(res.score).toBe(PROVISIONAL_SCORE_CAP);
      expect(res.tier).toBe('Good');
      expect(res.isProvisional).toBe(true);
      expect(res.confidenceScore).toBeLessThan(40);
      expect(res.confidenceTier).toBe('Low');
    });

    it('unblocks full score range once N >= 3 historical observations exist', () => {
      const res = calculateDealScore({
        priceEur: 25.00,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 40.00,
        allTimeLowEur: 25.00,
        sampleCount: 3 // N = 3
      });

      expect(res.score).toBeGreaterThanOrEqual(85);
      expect(res.tier).toBe('Exceptional');
      expect(res.isProvisional).toBe(false);
    });

    it('rates comprehensive long-term multi-source data as High Confidence (>80%)', () => {
      const now = new Date();
      const halfYearAgo = new Date(now.getTime() - 200 * 24 * 3600 * 1000);

      const res = calculateDataConfidence({
        sampleCount: 20,
        firstObservedAt: halfYearAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 3,
        isOfficialSource: true
      });

      expect(res.confidence).toBeGreaterThanOrEqual(80);
      expect(res.tier).toBe('High');
      expect(res.factors.sample).toBe(1.0);
      expect(res.factors.coverage).toBe(1.0);
      expect(res.factors.sources).toBe(1.0);
      expect(res.factors.freshness).toBe(1.0);
    });

    it('rates sparse first-day observation as Low Confidence (<40%)', () => {
      const now = new Date();
      const res = calculateDataConfidence({
        sampleCount: 1,
        firstObservedAt: now.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 1,
        isOfficialSource: true
      });

      expect(res.confidence).toBeLessThan(40);
      expect(res.tier).toBe('Low');
      expect(res.factors.coverage).toBe(0.40);
      expect(res.factors.sources).toBe(0.85);
    });

    it('accurately discounts stale observations (> 7 days stale)', () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000);
      const twoHundredDaysAgo = new Date(now.getTime() - 200 * 24 * 3600 * 1000);

      const freshRes = calculateDataConfidence({
        sampleCount: 16,
        firstObservedAt: twoHundredDaysAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 2,
        isOfficialSource: true
      });
      expect(freshRes.confidence).toBe(100);

      const staleRes = calculateDataConfidence({
        sampleCount: 16,
        firstObservedAt: twoHundredDaysAgo.toISOString(),
        lastObservedAt: tenDaysAgo.toISOString(),
        sourceCount: 2,
        isOfficialSource: true
      });
      // Freshness factor drops from 1.0 to 0.55
      expect(staleRes.factors.freshness).toBe(0.55);
      expect(staleRes.confidence).toBe(55);
      expect(staleRes.tier).toBe('Moderate');
    });

    it('applies coverage scaling based on tracking duration (14d, 60d, 180d)', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 3600 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000);

      const res3d = calculateDataConfidence({
        sampleCount: 16,
        firstObservedAt: threeDaysAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 2
      });
      expect(res3d.factors.coverage).toBe(0.45);

      const res20d = calculateDataConfidence({
        sampleCount: 16,
        firstObservedAt: twentyDaysAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 2
      });
      expect(res20d.factors.coverage).toBe(0.65);

      const res90d = calculateDataConfidence({
        sampleCount: 16,
        firstObservedAt: ninetyDaysAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 2
      });
      expect(res90d.factors.coverage).toBe(0.85);
    });

    it('passes firstObservedAt, lastObservedAt, and sourceCount cleanly through calculateDealScore', () => {
      const now = new Date();
      const yearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000);

      const result = calculateDealScore({
        priceEur: 19.99,
        basePriceEur: 59.99,
        typicalSaleMedianEur: 39.99,
        allTimeLowEur: 19.99,
        sampleCount: 25,
        firstObservedAt: yearAgo.toISOString(),
        lastObservedAt: now.toISOString(),
        sourceCount: 3,
        isOfficialSource: true
      });

      expect(result.confidenceScore).toBe(100);
      expect(result.confidenceTier).toBe('High');
      expect(result.explanation?.confidenceFactors.coverage).toBe(1.0);
      expect(result.explanation?.confidenceFactors.freshness).toBe(1.0);
      expect(result.explanation?.confidenceFactors.sources).toBe(1.0);
    });
  });

  // ----------------------------------------------------
  // 4. Benchmark: 20 Synthetic Price History Test Cases
  // ----------------------------------------------------
  describe('20 Synthetic Benchmark Suite', () => {
    it('Case 1: Stable price, rare discount (Factorio/RimWorld scenario)', () => {
      const res = calculateDealScore({
        priceEur: 27.00,
        basePriceEur: 30.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 27.00,
        sampleCount: 10
      });
      expect(res.tier).toBe('Good');
      expect(res.score).toBeGreaterThanOrEqual(55);
      expect(res.score).toBeLessThanOrEqual(70);
    });

    it('Case 2: Frequent discount 1 cent below normal ATL (AC Odyssey scenario)', () => {
      const res = calculateDealScore({
        priceEur: 11.98,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 12.00,
        allTimeLowEur: 11.99,
        sampleCount: 30
      });
      expect(['Weak', 'Fair']).toContain(res.tier);
      expect(res.score).toBeLessThan(50);
    });

    it('Case 3: Full retail price (No discount)', () => {
      const res = calculateDealScore({
        priceEur: 20.00,
        basePriceEur: 20.00,
        typicalSaleMedianEur: 10.00,
        allTimeLowEur: 5.00,
        sampleCount: 25
      });
      expect(res.tier).toBe('Weak');
      expect(res.score).toBeLessThan(10);
    });

    it('Case 4: Permanent MSRP cut with rolling window', () => {
      const res = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 20.00,
        typicalSaleMedianEur: 10.00,
        allTimeLowEur: 10.00,
        sampleCount: 12
      });
      expect(['Weak', 'Fair']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(30);
      expect(res.score).toBeLessThanOrEqual(45);
    });

    it('Case 5: Progressively declining price', () => {
      const res = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 15.00,
        allTimeLowEur: 10.00,
        sampleCount: 15
      });
      expect(['Great', 'Exceptional']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(75);
    });

    it('Case 6: Historical price glitch / single outlier', () => {
      const res = calculateDealScore({
        priceEur: 12.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 20.00,
        typicalSaleQ1Eur: 18.00,
        typicalSaleQ3Eur: 22.00,
        low1yEur: 12.00,
        allTimeLowEur: 1.99,
        sampleCount: 20
      });
      expect(['Great', 'Exceptional']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(80);
    });

    it('Case 7: 0-IQR Indie discount (Always 4.99€, now 4.49€)', () => {
      const res = calculateDealScore({
        priceEur: 4.49,
        basePriceEur: 9.99,
        typicalSaleMedianEur: 4.99,
        allTimeLowEur: 4.49,
        sampleCount: 15
      });
      expect(res.tier).toBe('Good');
      expect(res.score).toBeGreaterThanOrEqual(55);
      expect(res.score).toBeLessThanOrEqual(70);
    });

    it('Case 8: Low sample count with deep discount (Provisional Guard Active)', () => {
      const res = calculateDealScore({
        priceEur: 25.00,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 40.00,
        allTimeLowEur: 25.00,
        sampleCount: 2
      });
      // Correctly protected by Data Sufficiency Guard: Capped at Good (65), Low Confidence
      expect(res.score).toBe(65);
      expect(res.tier).toBe('Good');
      expect(res.isProvisional).toBe(true);
      expect(res.confidenceScore).toBeLessThan(40);
    });

    it('Case 9: Brand new release with 10% launch discount', () => {
      const res = calculateDealScore({
        priceEur: 54.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: null,
        sampleCount: 1
      });
      expect(res.tier).toBe('Weak');
      expect(res.score).toBeLessThanOrEqual(15);
    });

    it('Case 10: 10-year veteran game with routine low (Witcher 3)', () => {
      const res = calculateDealScore({
        priceEur: 5.99,
        basePriceEur: 29.99,
        typicalSaleMedianEur: 5.99,
        allTimeLowEur: 4.99,
        sampleCount: 80
      });
      expect(['Weak', 'Fair']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(30);
      expect(res.score).toBeLessThan(45);
    });

    it('Case 11: Frequent -80% sale at exact median', () => {
      const res = calculateDealScore({
        priceEur: 9.99,
        basePriceEur: 49.99,
        typicalSaleMedianEur: 9.99,
        allTimeLowEur: 8.99,
        sampleCount: 40
      });
      expect(res.score).toBeCloseTo(33, 0);
      expect(['Weak', 'Fair']).toContain(res.tier);
    });

    it('Case 12: Rare -50% sale on game that is almost never discounted', () => {
      const res = calculateDealScore({
        priceEur: 30.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 54.00,
        typicalSaleQ1Eur: 50.00,
        typicalSaleQ3Eur: 58.00,
        allTimeLowEur: 30.00,
        sampleCount: 12
      });
      expect(['Great', 'Exceptional']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(80);
    });

    it('Case 13: Current price matches median exactly', () => {
      const res = calculateDealScore({
        priceEur: 15.00,
        typicalSaleMedianEur: 15.00,
        allTimeLowEur: 10.00,
        sampleCount: 20
      });
      expect(res.score).toBeCloseTo(33, 0);
      expect(['Weak', 'Fair']).toContain(res.tier);
    });

    it('Case 14: Current price slightly below typical sale', () => {
      const res = calculateDealScore({
        priceEur: 17.50,
        typicalSaleMedianEur: 20.00,
        typicalSaleQ1Eur: 19.00,
        typicalSaleQ3Eur: 22.00,
        allTimeLowEur: 15.00,
        sampleCount: 25
      });
      expect(['Fair', 'Good']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(45);
      expect(res.score).toBeLessThan(65);
    });

    it('Case 15: Major new All-Time Low record', () => {
      const res = calculateDealScore({
        priceEur: 12.00,
        typicalSaleMedianEur: 30.00,
        typicalSaleQ1Eur: 25.00,
        typicalSaleQ3Eur: 35.00,
        allTimeLowEur: 20.00,
        sampleCount: 30
      });
      expect(res.tier).toBe('Exceptional');
      expect(res.score).toBeGreaterThanOrEqual(90);
    });

    it('Case 16: Current price far above typical sale', () => {
      const res = calculateDealScore({
        priceEur: 35.00,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 25.00,
        allTimeLowEur: 15.00,
        sampleCount: 20
      });
      expect(res.tier).toBe('Weak');
      expect(res.score).toBeLessThan(25);
    });

    it('Case 17: Fake discount after price hike', () => {
      const res = calculateDealScore({
        priceEur: 35.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 25.00,
        allTimeLowEur: 18.00,
        sampleCount: 15
      });
      expect(res.tier).toBe('Weak');
      expect(res.score).toBeLessThan(35);
    });

    it('Case 18: Seasonal Summer Sale peak low', () => {
      const res = calculateDealScore({
        priceEur: 14.99,
        typicalSaleMedianEur: 24.99,
        typicalSaleQ1Eur: 20.00,
        typicalSaleQ3Eur: 27.00,
        allTimeLowEur: 14.99,
        sampleCount: 20
      });
      expect(['Great', 'Exceptional']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(75);
    });

    it('Case 19: Minor keyshop voucher shift (20.00 -> 19.40€)', () => {
      const res = calculateDealScore({
        priceEur: 19.40,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 18.00,
        sampleCount: 25
      });
      expect(['Weak', 'Fair']).toContain(res.tier);
      expect(res.score).toBeLessThan(50);
    });

    it('Case 20: Highly volatile price range (5€ to 40€, now 8€)', () => {
      const res = calculateDealScore({
        priceEur: 8.00,
        typicalSaleMedianEur: 20.00,
        typicalSaleQ1Eur: 12.00,
        typicalSaleQ3Eur: 30.00,
        allTimeLowEur: 5.00,
        sampleCount: 30
      });
      expect(['Good', 'Great']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(55);
    });
  });

  // ----------------------------------------------------
  // 5. Extra 10 Edge Cases
  // ----------------------------------------------------
  describe('Extra 10 Edge Cases', () => {
    it('Edge 1: Price exactly equals ATL', () => {
      const res = calculateDealScore({
        priceEur: 10.00,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 10.00,
        sampleCount: 15
      });
      expect(res.rarityBonus).toBe(20.0);
      expect(res.score).toBeGreaterThanOrEqual(80);
    });

    it('Edge 2: Price is 0.01€ above ATL', () => {
      const res = calculateDealScore({
        priceEur: 10.01,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 10.00,
        sampleCount: 15
      });
      expect(res.rarityBonus).toBeCloseTo(19.96, 1);
    });

    it('Edge 3: Price is 0.01€ below ATL', () => {
      const res = calculateDealScore({
        priceEur: 9.99,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 10.00,
        sampleCount: 15
      });
      expect(res.rarityBonus).toBeGreaterThan(20.0);
    });

    it('Edge 4: Median equals ATL (all sales at same price)', () => {
      const res = calculateDealScore({
        priceEur: 5.00,
        typicalSaleMedianEur: 5.00,
        allTimeLowEur: 5.00,
        sampleCount: 10
      });
      expect(res.score).toBeCloseTo(33, 0);
      expect(['Weak', 'Fair']).toContain(res.tier);
    });

    it('Edge 5: No ATL available (null/undefined)', () => {
      const res = calculateDealScore({
        priceEur: 12.00,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: null,
        sampleCount: 10
      });
      expect(res.rarityBonus).toBe(0);
      expect(res.baseScore).toBeGreaterThan(50);
      expect(res.score).toBe(Math.round(res.baseScore));
    });

    it('Edge 6: No MSRP available', () => {
      const res = calculateDealScore({
        priceEur: 15.00,
        basePriceEur: undefined,
        typicalSaleMedianEur: 25.00,
        allTimeLowEur: 15.00,
        sampleCount: 10
      });
      expect(res.score).toBeGreaterThan(70);
    });

    it('Edge 7: Sub-euro median (< 1.00€)', () => {
      const res = calculateDealScore({
        priceEur: 0.49,
        typicalSaleMedianEur: 0.99,
        allTimeLowEur: 0.49,
        sampleCount: 10
      });
      expect(['Great', 'Exceptional']).toContain(res.tier);
      expect(res.score).toBeGreaterThanOrEqual(75);
    });

    it('Edge 8: Pure price calculation separates risk from math', () => {
      // Mathematical Deal Score evaluates price, caller checks riskLevel / isAnomaly
      const res = calculateDealScore({
        priceEur: 10.00,
        typicalSaleMedianEur: 50.00,
        allTimeLowEur: 10.00,
        isAnomaly: true,
        riskLevel: 'HIGH',
        sampleCount: 30
      });
      expect(res.score).toBeGreaterThanOrEqual(85);
    });

    it('Edge 9: Negative or zero price handled cleanly by math', () => {
      const resZero = calculateDealScore({
        priceEur: 0,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 0,
        sampleCount: 10
      });
      expect(resZero.score).toBeGreaterThanOrEqual(85);
    });

    it('Edge 10: Score never exceeds 100 or drops below 0', () => {
      const resHigh = calculateDealScore({
        priceEur: 0.50,
        typicalSaleMedianEur: 100.00,
        allTimeLowEur: 1.00,
        sampleCount: 50
      });
      expect(resHigh.score).toBe(100);

      const resLow = calculateDealScore({
        priceEur: 200.00,
        typicalSaleMedianEur: 10.00,
        allTimeLowEur: 5.00,
        sampleCount: 50
      });
      expect(resLow.score).toBe(0);
    });

    it('Edge 11: Unconfirmed ATL (isConfirmedAtl: false) halves rarity bonus', () => {
      const resConfirmed = calculateDealScore({
        priceEur: 15.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 15.00,
        isConfirmedAtl: true,
        sampleCount: 20
      });

      const resUnconfirmed = calculateDealScore({
        priceEur: 15.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 15.00,
        isConfirmedAtl: false,
        sampleCount: 20
      });

      expect(resConfirmed.rarityBonus).toBe(20.0);
      expect(resUnconfirmed.rarityBonus).toBe(10.0);
      expect(resConfirmed.score).toBeGreaterThan(resUnconfirmed.score);
    });

    it('Edge 12: Single-source keyshop low (isSingleSourceLow: true) halves rarity bonus', () => {
      const resSingleSource = calculateDealScore({
        priceEur: 10.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 15.00,
        isSingleSourceLow: true,
        sampleCount: 20
      });

      // At 10€ vs 15€ ATL, full recordBonus would be 35.0 -> halved to 17.5
      expect(resSingleSource.rarityBonus).toBe(17.5);
    });
  });
});
