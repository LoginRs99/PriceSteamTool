import { describe, it, expect } from 'vitest';
import { calculateDealScore } from '../../src/server/domain/dealScore/calculator.js';
import { calculateDataConfidence } from '../../src/server/domain/dealScore/confidence.js';
import { calculateTypicalSalePrice } from '../../src/server/domain/priceIntelligence/typicalSale.js';
import { calculatePeriodLows } from '../../src/server/domain/priceIntelligence/periodLows.js';
import { calculatePriceVolatility } from '../../src/server/domain/priceIntelligence/volatility.js';
import { groupSaleEvents } from '../../src/server/domain/priceIntelligence/saleEvents.js';
import { detectPricingError, checkOverMsrp } from '../../src/server/domain/pricingError/detector.js';
import { generateActionSignal } from '../../src/server/domain/actionSignal/decision.js';
import { evaluatePurchaseAdvice } from '../../src/server/domain/priceIntelligence/purchaseAdvice.js';
import { calculateSteamDbRating } from '../../src/server/domain/rating.js';
import { exchangeRateService } from '../../src/server/domain/exchangeRate.js';
import type { PriceHistoryEntry, Game, Offer } from '../../src/shared/types.js';

describe('Mathematical Logic & Boundary Audit Suite', () => {

  describe('1. DealScore Invariants & Boundary Tests', () => {
    it('always returns score in [0, 100] for invalid or adversarial numerical inputs', () => {
      const adversarialCases = [
        { priceEur: -5 },
        { priceEur: NaN },
        { priceEur: Infinity },
        { priceEur: -Infinity },
        { priceEur: 0, basePriceEur: -10 },
        { priceEur: 10, basePriceEur: 0 },
        { priceEur: 10, basePriceEur: NaN },
        { priceEur: 10, typicalSaleMedianEur: -5 },
        { priceEur: 10, allTimeLowEur: -1 },
        { priceEur: 10, sampleCount: -10 },
        { priceEur: 10, daysSinceLastSample: -5 }
      ];

      for (const c of adversarialCases) {
        const res = calculateDealScore(c as any);
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
        expect(Number.isFinite(res.score)).toBe(true);
      }
    });

    it('strictly satisfies price monotonicity: lower price produces equal or higher score (holding all else constant)', () => {
      const prices = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 2, 1, 0.5, 0];
      let prevScore = -1;

      // Reverse order: test ascending from 0 up to 50 EUR (score should decrease or stay equal)
      const scores: number[] = [];
      for (const p of prices) {
        const res = calculateDealScore({
          priceEur: p,
          basePriceEur: 60,
          typicalSaleMedianEur: 30,
          allTimeLowEur: 15,
          isConfirmedAtl: true,
          sampleCount: 10,
          offersCount: 5,
          minOfferEur: 15,
          maxOfferEur: 60
        });
        scores.push(res.score);
      }

      // From 50 down to 0, score must be monotonically non-decreasing
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i], `Price €${prices[i]} score (${scores[i]}) should be >= price €${prices[i - 1]} score (${scores[i - 1]})`).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });

    it('score 100 is strictly reserved: score cannot reach 100 unless price beats confirmed ATL by >= 5%', () => {
      // 1. Matches confirmed ATL exactly (price == atl) -> max score is capped at 99
      const atAtl = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 10.00,
        isConfirmedAtl: true,
        sampleCount: 20,
        offersCount: 5,
        minOfferEur: 10.00,
        maxOfferEur: 60.00
      });
      expect(atAtl.score).toBeLessThanOrEqual(99);

      // 2. Beats unconfirmed ATL -> cannot reach 100
      const unconfirmedBeat = calculateDealScore({
        priceEur: 8.00, // 20% undercut
        basePriceEur: 60.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 10.00,
        isConfirmedAtl: false,
        sampleCount: 20,
        offersCount: 5,
        minOfferEur: 8.00,
        maxOfferEur: 60.00
      });
      expect(unconfirmedBeat.score).toBeLessThanOrEqual(99);

      // 3. Beats confirmed ATL by >= 5% on 100% discount (free giveaway) -> reaches 100
      const confirmedBeat5Pct = calculateDealScore({
        priceEur: 0.00, // 100% undercut of confirmed ATL (10.00)
        basePriceEur: 60.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 10.00,
        isConfirmedAtl: true,
        isSingleSourceLow: false,
        sampleCount: 20,
        offersCount: 5,
        minOfferEur: 0.00,
        maxOfferEur: 60.00
      });
      expect(confirmedBeat5Pct.score).toBe(100);
    });

    it('enforces provisional caps when sampleCount < 3 or no history', () => {
      // No history at all -> capped at NO_HISTORY_CAP (40)
      const noHist = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 50.00,
        sampleCount: 0
      });
      expect(noHist.isProvisional).toBe(true);
      expect(noHist.score).toBeLessThanOrEqual(40);

      // Some history (sampleCount = 2 < 3) -> capped at PROVISIONAL_CAP (65) for normal discounts
      const someHist = calculateDealScore({
        priceEur: 30.00,
        basePriceEur: 50.00, // 40% discount < 60%
        typicalSaleMedianEur: 40.00,
        allTimeLowEur: 25.00,
        sampleCount: 2
      });
      expect(someHist.isProvisional).toBe(true);
      expect(someHist.score).toBeLessThanOrEqual(65);

      // Deep discount (>= 60%) with low samples -> capped at PROVISIONAL_DEEP_CAP (80 / 85)
      const deepHist = calculateDealScore({
        priceEur: 15.00,
        basePriceEur: 50.00, // 70% discount >= 60%
        typicalSaleMedianEur: 35.00,
        allTimeLowEur: 15.00,
        sampleCount: 2
      });
      expect(deepHist.isProvisional).toBe(true);
      expect(deepHist.score).toBeLessThanOrEqual(85);
    });

    it('enforces stale cap when price observation is stale', () => {
      const staleRes = calculateDealScore({
        priceEur: 5.00,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 5.00,
        sampleCount: 20,
        isStalePrice: true
      });
      expect(staleRes.score).toBeLessThanOrEqual(50);
    });

    it('correctly classifies OVERPRICED when price strictly exceeds MSRP', () => {
      const overpriced = calculateDealScore({
        priceEur: 65.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 40.00,
        allTimeLowEur: 30.00,
        sampleCount: 15
      });
      expect(overpriced.verdict).toBe('OVERPRICED');
    });
  });

  describe('2. Data Confidence Calculation', () => {
    it('scales monotonically with sample count N', () => {
      const c0 = calculateDataConfidence({ sampleCount: 0 });
      const c1 = calculateDataConfidence({ sampleCount: 1 });
      const c4 = calculateDataConfidence({ sampleCount: 4 });
      const c16 = calculateDataConfidence({ sampleCount: 16 });

      expect(c0.confidence).toBe(0);
      expect(c1.confidence).toBeGreaterThanOrEqual(c0.confidence);
      expect(c4.confidence).toBeGreaterThan(c1.confidence);
      expect(c16.confidence).toBeGreaterThan(c4.confidence);
    });

    it('handles inverted observation timestamps gracefully (tLast < tFirst)', () => {
      const inv = calculateDataConfidence({
        sampleCount: 10,
        firstObservedAt: '2026-10-01T00:00:00Z',
        lastObservedAt: '2026-05-01T00:00:00Z'
      });
      expect(inv.confidence).toBeGreaterThan(0);
      expect(inv.factors.coverage).toBe(0.45); // default fallback coverage
    });
  });

  describe('3. Typical Sale Price (Tukey IQR)', () => {
    it('returns null median when history has zero discount observations', () => {
      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 60.00, recordedAt: '2026-01-01T00:00:00Z' }
      ];
      const res = calculateTypicalSalePrice(60.00, history);
      expect(res.medianPriceEur).toBeNull();
      expect(res.isLowConfidence).toBe(true);
    });

    it('filters out both sub-euro glitches and price spikes using Tukey fences', () => {
      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 0.10, recordedAt: '2026-01-01T00:00:00Z' }, // glitch
        { id: '2', gameId: 'g1', sourceCode: 'steam', priceEur: 19.99, recordedAt: '2026-02-01T00:00:00Z' },
        { id: '3', gameId: 'g1', sourceCode: 'steam', priceEur: 19.99, recordedAt: '2026-03-01T00:00:00Z' },
        { id: '4', gameId: 'g1', sourceCode: 'steam', priceEur: 21.99, recordedAt: '2026-04-01T00:00:00Z' },
        { id: '5', gameId: 'g1', sourceCode: 'steam', priceEur: 22.99, recordedAt: '2026-05-01T00:00:00Z' },
        { id: '6', gameId: 'g1', sourceCode: 'steam', priceEur: 23.99, recordedAt: '2026-06-01T00:00:00Z' }
      ];
      const res = calculateTypicalSalePrice(50.00, history);
      expect(res.medianPriceEur).toBeCloseTo(21.99, 1);
      expect(res.sampleCount).toBe(5); // 0.10 excluded
    });
  });

  describe('4. Period Lows & Provenance', () => {
    const game: Game = {
      id: 'g1',
      steamAppId: 100,
      title: 'Test Game',
      slug: 'test-game',
      basePriceEur: 50.00,
      historicalLowEur: 20.00,
      historicalLowSource: 'Steam',
      atlIsConfirmed: true,
      isDlc: false,
      isFree: false,
      hasPricingError: false,
      offersCount: 1,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-27T00:00:00Z'
    };

    it('computes 7d low when fresh observation exists, but nulls 30d/90d if history span is too short', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 25.00, recordedAt: threeDaysAgo, isOfficial: true }
      ];

      const res = calculatePeriodLows(game, history);
      expect(res.low7d.priceEur).toBe(25.00);
      expect(res.low30d.priceEur).toBeNull(); // span is 3 days < 30 * 0.70 (21 days)
      expect(res.low90d.priceEur).toBeNull();
    });

    it('flags single-source unofficial low as isSingleSourceLow', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 40 * 24 * 3600 * 1000).toISOString();
      const yesterday = new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString();

      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 30.00, recordedAt: thirtyDaysAgo, isOfficial: true },
        { id: '2', gameId: 'g1', sourceCode: 'allkeyshop', merchantName: 'Kinguin', priceEur: 12.00, recordedAt: yesterday, isOfficial: false }
      ];

      const res = calculatePeriodLows(game, history);
      expect(res.low7d.priceEur).toBe(12.00);
      expect(res.low7d.isSingleSourceLow).toBe(true);
    });
  });

  describe('5. Pricing Error Detector Ratios and Signals', () => {
    it('detects DECIMAL_SHIFT missing digit shift (1/10 of MSRP)', () => {
      const evalRes = detectPricingError({
        priceEur: 5.99,
        steamBasePriceEur: 59.99,
        otherFreshPricesEur: [54.99, 59.99]
      });
      expect(evalRes.isLikelyPricingError).toBe(true);
      expect(evalRes.type).toBe('DECIMAL_SHIFT');
    });

    it('detects BELOW_ATL_IMPLAUSIBLE when price is >60% below confirmed ATL', () => {
      const evalRes = detectPricingError({
        priceEur: 3.00,
        confirmedAtlEur: 20.00,
        atlIsConfirmed: true,
        steamBasePriceEur: 50.00
      });
      expect(evalRes.isLikelyPricingError).toBe(true);
      expect(evalRes.type).toBe('BELOW_ATL_IMPLAUSIBLE');
    });

    it('overrides selling-price anomalies when corroborated by >= 2 independent peers', () => {
      const evalRes = detectPricingError({
        priceEur: 5.99,
        steamBasePriceEur: 59.99,
        otherFreshPricesEur: [5.99, 6.20] // 2 independent stores confirm €5.99 flash sale
      });
      expect(evalRes.isLikelyPricingError).toBe(false);
    });

    it('identifies checkOverMsrp with 5% tolerance', () => {
      expect(checkOverMsrp(60.00, 60.00)).toBe(false);
      expect(checkOverMsrp(62.99, 60.00)).toBe(false); // 62.99 <= 63.00 (5%)
      expect(checkOverMsrp(63.50, 60.00)).toBe(true);  // > 5% over MSRP
    });
  });

  describe('6. SteamDB Bayesian Wilson Score Rating', () => {
    it('produces expected rating and pulls small sample size towards 50%', () => {
      // 100% positive with only 1 review -> pulled strongly towards 50%
      const r1 = calculateSteamDbRating(100, 1);
      expect(r1).toBeLessThan(75);
      expect(r1).toBeGreaterThan(50);

      // 100% positive with 10,000 reviews -> approaches 100%
      const rBig = calculateSteamDbRating(100, 10000);
      expect(rBig).toBeGreaterThan(95);

      // Undefined inputs return undefined
      expect(calculateSteamDbRating(undefined, 100)).toBeUndefined();
      expect(calculateSteamDbRating(80, 0)).toBeUndefined();
      expect(calculateSteamDbRating(105, 50)).toBeUndefined();
    });
  });

  describe('7. Currency Normalization & Conversions', () => {
    it('round-trips EUR to foreign currency and back with high precision', () => {
      const eur = 29.99;
      const rateUsd = exchangeRateService.getRatesFromEur()['USD'];
      const usdAmount = eur * rateUsd;
      const convertedBack = exchangeRateService.convertToEur(usdAmount, 'USD');
      expect(convertedBack).toBeCloseTo(eur, 1);
    });
  });
});
