import { describe, it, expect } from 'vitest';
import { calculateDealScore } from '../../src/server/domain/dealScore/calculator.js';
import { detectPricingError } from '../../src/server/domain/pricingError/detector.js';
import { evaluatePriceMovement, evaluateSourceOwnHistoryAnomaly } from '../../src/server/domain/pricingError/index.js';
import { evaluatePurchaseAdvice } from '../../src/server/domain/priceIntelligence/purchaseAdvice.js';
import type { Game, Offer, PriceIntelligenceResponse, TypicalSalePrice, ActionSignal } from '../../src/shared/types.js';

describe('Critical Audit & Edge Cases: DealScore v2.3 & Anomaly Detection', () => {
  describe('Issue A — ATL > typical_sale_median Reconciliation', () => {
    const anomalousGameFixtures = [
      { name: 'ANNO: Mutationem', atl: 8.98, median: 7.89, current: 7.50 },
      { name: 'Blacksmith Master', atl: 8.20, median: 7.58, current: 7.00 },
      { name: 'Eclipsium', atl: 8.31, median: 5.52, current: 5.00 },
      { name: 'ENDER MAGNOLIA', atl: 13.74, median: 7.50, current: 6.99 },
      { name: 'Frozen Flame', atl: 14.62, median: 8.70, current: 8.00 },
      { name: 'Inkbound', atl: 6.24, median: 3.79, current: 3.50 },
      { name: 'Lost Castle 2', atl: 11.83, median: 6.40, current: 5.99 },
      { name: 'NEKOPARA Vol.3', atl: 3.90, median: 1.80, current: 1.50 },
      { name: 'Starbound', atl: 3.49, median: 1.57, current: 1.49 },
      { name: 'Wizard of Legend', atl: 4.79, median: 3.30, current: 3.00 }
    ];

    for (const g of anomalousGameFixtures) {
      it(`reconciles ATL and median for "${g.name}" without negative denominator or division by zero`, () => {
        const res = calculateDealScore({
          priceEur: g.current,
          basePriceEur: 29.99,
          allTimeLowEur: g.atl,
          typicalSaleMedianEur: g.median,
          sampleCount: 15
        });

        // Denominator must never invert score or yield NaN/Infinity
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
        expect(isNaN(res.score)).toBe(false);
        expect(res.components?.historicalValue).toBeGreaterThanOrEqual(0);
        expect(res.components?.atlProximity).toBeGreaterThanOrEqual(0);
      });
    }

    it('sets S_hist to full 20 points when price matches or beats reconciled ATL and median == ATL', () => {
      const res = calculateDealScore({
        priceEur: 7.00,
        basePriceEur: 20.00,
        allTimeLowEur: 10.00, // Stale ATL > median
        typicalSaleMedianEur: 8.00, // Reconciled ATL = 8.00
        sampleCount: 10
      });

      // Price (7.00) is below reconciled ATL (8.00)
      expect(res.components?.historicalValue).toBe(20);
    });
  });

  describe('Issue B — FX Rounding (±0.01 / ±0.02) & Market Position', () => {
    it('awards full 10 points in S_mkt when all offers are within 0.02 EUR FX rounding spread', () => {
      const res1 = calculateDealScore({
        priceEur: 15.51,
        minOfferEur: 15.50,
        maxOfferEur: 15.51,
        offersCount: 2,
        basePriceEur: 29.99
      });

      const res2 = calculateDealScore({
        priceEur: 15.50,
        minOfferEur: 15.50,
        maxOfferEur: 15.51,
        offersCount: 2,
        basePriceEur: 29.99
      });

      // Both stores should get full 10 market points because spread is within 0.02 EUR
      expect(res1.components?.marketPosition).toBe(10);
      expect(res2.components?.marketPosition).toBe(10);
    });

    it('treats offers within 0.02 EUR as corroborated in anomaly detection', () => {
      const res = detectPricingError({
        priceEur: 15.51,
        otherFreshPricesEur: [15.50, 15.52]
      });

      expect(res.isLikelyPricingError).toBe(false);
    });
  });

  describe('Issue C — Delisted and Unreleased Games', () => {
    it('exempts delisted games with scarcity markup from OVERPRICED verdict and FAKE_BASELINE', () => {
      // Delisted game (e.g. App 1150590) with keyshop price 417.02 vs official MSRP 39.99
      const dealRes = calculateDealScore({
        priceEur: 417.02,
        basePriceEur: 39.99,
        isDelisted: true
      });

      expect(dealRes.verdict).not.toBe('OVERPRICED');
      expect(dealRes.components?.discountDepth).toBe(0);

      const anomalyRes = detectPricingError({
        priceEur: 417.02,
        steamBasePriceEur: 39.99,
        claimedOriginalPriceEur: 417.02,
        isDelisted: true
      });

      expect(anomalyRes.isLikelyPricingError).toBe(false);
    });

    it('exempts unreleased games from OVERPRICED verdict and FAKE_BASELINE', () => {
      const dealRes = calculateDealScore({
        priceEur: 79.99,
        basePriceEur: 69.99,
        isUnreleased: true
      });

      expect(dealRes.verdict).not.toBe('OVERPRICED');
      expect(dealRes.components?.discountDepth).toBe(0);

      const anomalyRes = detectPricingError({
        priceEur: 79.99,
        steamBasePriceEur: 69.99,
        claimedOriginalPriceEur: 120.00,
        isUnreleased: true
      });

      expect(anomalyRes.isLikelyPricingError).toBe(false);
    });
  });

  describe('Anomaly Detector Signal Refinements', () => {
    it('does NOT flag legitimate 93% deep publisher discount (.hack//G.U. 3.49 vs 49.99 MSRP) as DECIMAL_SHIFT', () => {
      const res = detectPricingError({
        priceEur: 3.49,
        steamBasePriceEur: 49.99,
        otherFreshPricesEur: [4.50]
      });

      // Ratio is 0.0698, not a missing digit 0.10/0.01 glitch
      expect(res.type).not.toBe('DECIMAL_SHIFT');
      expect(res.isLikelyPricingError).toBe(false);
    });

    it('does NOT flag price matching confirmed ATL (Re:ZERO 5.99 on 59.99 MSRP with confirmed ATL 5.99) as DECIMAL_SHIFT', () => {
      const res = detectPricingError({
        priceEur: 5.99,
        steamBasePriceEur: 59.99,
        confirmedAtlEur: 5.99,
        atlIsConfirmed: true
      });

      expect(res.isLikelyPricingError).toBe(false);
    });

    it('FLAGS true missing-digit decimal shift (4.99 on 49.99 MSRP with no history or peers)', () => {
      const res = detectPricingError({
        priceEur: 4.99,
        steamBasePriceEur: 49.99,
        otherFreshPricesEur: [45.00, 48.00]
      });

      // Ratio is exactly 0.0998 (~0.10) with peers at MSRP
      expect(res.isLikelyPricingError).toBe(true);
      expect(res.type).toBe('DECIMAL_SHIFT');
    });

    it('does NOT trigger BELOW_ATL_IMPLAUSIBLE if ATL is unconfirmed', () => {
      const res = detectPricingError({
        priceEur: 2.00,
        confirmedAtlEur: 10.00,
        atlIsConfirmed: false,
        steamBasePriceEur: 30.00
      });

      expect(res.type).not.toBe('BELOW_ATL_IMPLAUSIBLE');
    });

    it('triggers BELOW_ATL_IMPLAUSIBLE if ATL is confirmed and price is < 50% of confirmed ATL', () => {
      const res = detectPricingError({
        priceEur: 2.00,
        confirmedAtlEur: 10.00,
        atlIsConfirmed: true,
        steamBasePriceEur: 30.00
      });

      expect(res.isLikelyPricingError).toBe(true);
      expect(res.type).toBe('BELOW_ATL_IMPLAUSIBLE');
    });

    it('corroborates publisher sales within 15% across stores', () => {
      const res = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 49.99,
        otherFreshPricesEur: [4.95, 5.20] // Within 15%
      });

      expect(res.isLikelyPricingError).toBe(false);
    });
  });

  describe('Fix 1, 2 & 3: Diminishing-Returns Curve, Beat Bonus & Score 100 Reservation', () => {
    it('Fix 1: S_disc never prematurely saturates and strictly differentiates deep discounts', () => {
      const base = 60.0;
      const getDisc = (price: number) => {
        const res = calculateDealScore({
          priceEur: price,
          basePriceEur: base
        });
        return res.components?.discountDepth ?? 0;
      };

      const s50 = getDisc(30.0); // 50%
      const s75 = getDisc(15.0); // 75%
      const s80 = getDisc(12.0); // 80%
      const s86 = getDisc(8.0);  // 86.7%
      const s90 = getDisc(6.0);  // 90%
      const s95 = getDisc(3.0);  // 95%
      const s98 = getDisc(1.0);  // 98.3%

      // Strictly increasing past 75% without flatlining
      expect(s75).toBeGreaterThan(s50);
      expect(s80).toBeGreaterThan(s75);
      expect(s86).toBeGreaterThan(s80);
      expect(s90).toBeGreaterThan(s86);
      expect(s95).toBeGreaterThan(s90);
      expect(s98).toBeGreaterThan(s95);

      // 1€ vs 8€ gap is meaningful (> 2 points)
      expect(s98 - s86).toBeGreaterThan(2.0);

      // Noise (1.49€ vs 1.50€) is negligible (< 0.05 points)
      const s149 = getDisc(1.49);
      const s150 = getDisc(1.50);
      expect(Math.abs(s149 - s150)).toBeLessThan(0.05);
    });

    it('Fix 2: S_atl awards 36 at ATL and scales up to 40 for beating ATL (beat bonus)', () => {
      const getAtlScore = (price: number) => {
        const res = calculateDealScore({
          priceEur: price,
          basePriceEur: 40.0,
          allTimeLowEur: 10.0,
          sampleCount: 15,
          isConfirmedAtl: true
        });
        return res.components?.atlProximity ?? 0;
      };

      // At ATL (10€): exactly 36.0
      expect(getAtlScore(10.0)).toBe(36.0);

      // 5% beat (9.50€): 36 + 4*(0.5/2.0) = 37.0
      expect(getAtlScore(9.50)).toBe(37.0);

      // 10% beat (9.00€): 36 + 4*(1.0/2.0) = 38.0
      expect(getAtlScore(9.00)).toBe(38.0);

      // 20% beat (8.00€): 36 + 4 = 40.0
      expect(getAtlScore(8.00)).toBe(40.0);

      // >20% beat (6.00€): capped at 40.0
      expect(getAtlScore(6.00)).toBe(40.0);
    });

    it('Fix 3: Score 100 is reserved exclusively for offers beating confirmed ATL by >= 5%', () => {
      // 1. Near-perfect offer matching confirmed ATL: S_atl is 36, max theoretical total <= 96
      const resMatchAtl = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 100.00,
        typicalSaleMedianEur: 100.00,
        allTimeLowEur: 10.00,
        offersCount: 2,
        minOfferEur: 10.00,
        maxOfferEur: 50.00,
        sampleCount: 50,
        isConfirmedAtl: true
      });
      expect(resMatchAtl.score).toBeLessThanOrEqual(96);
      expect(resMatchAtl.score).toBeGreaterThanOrEqual(90);

      // 2. Near-perfect offer with unconfirmed ATL (isConfirmedAtl: false): halved ATL, cannot reach 100
      const resUnconfirmed = calculateDealScore({
        priceEur: 0.50,
        basePriceEur: 100.00,
        typicalSaleMedianEur: 100.00,
        allTimeLowEur: 1.00,
        offersCount: 2,
        minOfferEur: 0.50,
        maxOfferEur: 50.00,
        sampleCount: 50,
        isConfirmedAtl: false
      });
      expect(resUnconfirmed.score).toBeLessThanOrEqual(99);

      // 3. Near-perfect offer beating confirmed ATL by 50% (>= 5% threshold): reaches full 100
      const resBeatAtl = calculateDealScore({
        priceEur: 0.50,
        basePriceEur: 100.00,
        typicalSaleMedianEur: 100.00,
        allTimeLowEur: 1.00,
        offersCount: 2,
        minOfferEur: 0.50,
        maxOfferEur: 10.00,
        sampleCount: 50,
        isConfirmedAtl: true
      });
      expect(resBeatAtl.score).toBe(100);
    });

    it('Division-by-zero guards: handles free games, zero anchors, zero ATLs, and negative inputs cleanly', () => {
      // 1. Free giveaway from paid base (price = 0, basePrice = 20)
      const resFree = calculateDealScore({
        priceEur: 0,
        basePriceEur: 20.0,
        typicalSaleMedianEur: 10.0,
        allTimeLowEur: 5.0,
        sampleCount: 10,
        isConfirmedAtl: true
      });
      expect(isNaN(resFree.score)).toBe(false);
      expect(resFree.score).toBeGreaterThanOrEqual(80);
      expect(resFree.components?.discountDepth).toBe(30);

      // 2. Free-to-play / 0 MSRP game (price = 0, basePrice = 0)
      const resZeroAnchor = calculateDealScore({
        priceEur: 0,
        basePriceEur: 0,
        sampleCount: 5
      });
      expect(isNaN(resZeroAnchor.score)).toBe(false);
      expect(resZeroAnchor.components?.discountDepth).toBe(0);

      // 3. Zero ATL (atl = 0)
      const resZeroAtl = calculateDealScore({
        priceEur: 0,
        basePriceEur: 20.0,
        allTimeLowEur: 0,
        sampleCount: 5
      });
      expect(isNaN(resZeroAtl.score)).toBe(false);
      expect(resZeroAtl.components?.atlProximity).toBe(36);

      // 4. Negative price input defensive guard
      const resNeg = calculateDealScore({
        priceEur: -10,
        basePriceEur: 20.0,
        sampleCount: 5
      });
      expect(isNaN(resNeg.score)).toBe(false);
      expect(resNeg.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Priority Tier 1: Issue 7, 8 & 13 Verification', () => {
    it('Issue 7: Single peer on a normal price (>€1.005) does NOT corroborate anomaly when merchant independence is unconfirmed', () => {
      // 59.99€ game with confirmed ATL of 25.00€; price drops to 5.00€ (<50% of ATL, triggers BELOW_ATL_IMPLAUSIBLE)
      // and only 1 peer is at 5.20€ with unknown merchant independence
      const resSinglePeerUnconfirmed = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 59.99,
        confirmedAtlEur: 25.00,
        atlIsConfirmed: true,
        otherFreshPricesEur: [5.20], // Only 1 matching peer
        independentMerchantCount: undefined // Unknown independence
      });

      // Must NOT be corroborated: 1 peer without confirmed independent merchants cannot clear BELOW_ATL_IMPLAUSIBLE
      expect(resSinglePeerUnconfirmed.isLikelyPricingError).toBe(true);
      expect(resSinglePeerUnconfirmed.type).toBe('BELOW_ATL_IMPLAUSIBLE');
    });

    it('Issue 7: Two matching peers corroborate normal price (>€1.005)', () => {
      const resTwoPeers = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 59.99,
        confirmedAtlEur: 25.00,
        atlIsConfirmed: true,
        otherFreshPricesEur: [4.95, 5.05] // 2 independent matching peers
      });

      expect(resTwoPeers.isLikelyPricingError).toBe(false);
    });

    it('Issue 7: Single peer with confirmed independent merchant count >= 2 corroborates', () => {
      const resConfirmedMerchants = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 59.99,
        confirmedAtlEur: 25.00,
        atlIsConfirmed: true,
        otherFreshPricesEur: [5.10],
        independentMerchantCount: 2 // Explicitly 2 independent merchants
      });

      expect(resConfirmedMerchants.isLikelyPricingError).toBe(false);
    });

    it('Issue 7: Sub-euro price (<=1.005) preserves single-peer corroboration within 30%', () => {
      const resSubEuro = detectPricingError({
        priceEur: 0.50,
        steamBasePriceEur: 59.99,
        otherFreshPricesEur: [0.60] // Single peer within 30%
      });

      expect(resSubEuro.isLikelyPricingError).toBe(false);
    });

    it('Issue 13: Unconfirmed suspiciously low ATL (<15% of median) heals floor and does NOT suppress anomaly', () => {
      // €59.99 game with unconfirmed past glitch ATL of €0.49, median sale €20.00
      // An unconfirmed €0.49 offer should NOT be excused by the previous unconfirmed glitch ATL!
      const resUnconfirmedGlitch = detectPricingError({
        priceEur: 0.49,
        steamBasePriceEur: 59.99,
        typicalSaleMedianEur: 20.00,
        confirmedAtlEur: 0.49,
        atlIsConfirmed: false // Unconfirmed glitch in history!
      });

      expect(resUnconfirmedGlitch.isLikelyPricingError).toBe(true);
      expect(resUnconfirmedGlitch.type).toBe('DECIMAL_SHIFT');
    });

    it('Issue 13: Confirmed ATL (<15% of median) is trusted and excuses known low', () => {
      // If a publisher legitimately set a confirmed promotional ATL of €0.49
      const resConfirmedPromo = detectPricingError({
        priceEur: 0.49,
        steamBasePriceEur: 59.99,
        typicalSaleMedianEur: 20.00,
        confirmedAtlEur: 0.49,
        atlIsConfirmed: true
      });

      // Confirmed ATL is recognized as known historic level, not an unverified decimal shift
      expect(resConfirmedPromo.isLikelyPricingError).toBe(false);
    });

    it('Issue 13: DealScore heals unconfirmed glitch ATL to prevent score inversion', () => {
      // Glitch ATL of €0.49 on a €29.99 game with median €15.00
      const scoreGlitchAtl = calculateDealScore({
        priceEur: 5.00,
        basePriceEur: 29.99,
        typicalSaleMedianEur: 15.00,
        allTimeLowEur: 0.49,
        isConfirmedAtl: false,
        isSingleSourceLow: true
      });

      // Effective ATL heals to max(0.49, 15 * 0.20) = 3.00
      // Score calculation remains sound, finite, and positive
      expect(scoreGlitchAtl.score).toBeGreaterThan(0);
      expect(scoreGlitchAtl.score).toBeLessThanOrEqual(100);
      expect(scoreGlitchAtl.explanation?.atlDistanceEur).toBe(2.00); // 5.00 - 3.00 = 2.00
    });

    it('Issue 8: MARKET_OUTLIER accurately detects extreme drops with >=2 peers without redundant logic', () => {
      const resOutlier = detectPricingError({
        priceEur: 2.00,
        steamBasePriceEur: 29.99,
        otherFreshPricesEur: [10.00, 15.00]
      });

      expect(resOutlier.isLikelyPricingError).toBe(true);
      expect(resOutlier.type).toBe('MARKET_OUTLIER');
    });
  });

  describe('Priority Tier 2: Issue 9, 10, 14, 15 & 16 Verification', () => {
    it('Issue 9: BELOW_ATL_IMPLAUSIBLE uses consistent threshold (40%) and does NOT over-penalize cheap games', () => {
      // Game with confirmed ATL €3.00: 50% drop to €1.50 is normal keyshop variation
      const resCheapNormal = detectPricingError({
        priceEur: 1.50,
        steamBasePriceEur: 19.99,
        confirmedAtlEur: 3.00,
        atlIsConfirmed: true
      });
      expect(resCheapNormal.type).not.toBe('BELOW_ATL_IMPLAUSIBLE');

      // True implausible collapse: <40% of confirmed ATL (€1.10 on €3.00 ATL)
      const resCheapGlitch = detectPricingError({
        priceEur: 1.10,
        steamBasePriceEur: 19.99,
        confirmedAtlEur: 3.00,
        atlIsConfirmed: true
      });
      expect(resCheapGlitch.isLikelyPricingError).toBe(true);
      expect(resCheapGlitch.type).toBe('BELOW_ATL_IMPLAUSIBLE');
    });

    it('Issue 10: OWN_HISTORY_BREAK scale floor prevents false positives on small coupons / sales', () => {
      // Store consistently charges €9.99; runs a small promo at €9.10
      const resSmallDiscount = evaluateSourceOwnHistoryAnomaly(9.10, [9.99, 9.99, 9.99]);
      expect(resSmallDiscount.applicable).toBe(true);
      expect(resSmallDiscount.isBreak).toBe(false); // Must NOT flag as store collapse!

      // Store suddenly collapses from €19.99 to €2.00
      const resTrueCollapse = evaluateSourceOwnHistoryAnomaly(2.00, [19.99, 19.99, 19.99]);
      expect(resTrueCollapse.applicable).toBe(true);
      expect(resTrueCollapse.isBreak).toBe(true); // Must flag true collapse!
    });

    it('Issue 15: Outlier summary reports exact peer minimum and median for multi-peer outliers', () => {
      const resMultiPeer = evaluatePriceMovement({
        currentPriceEur: 3.00,
        basePriceEur: 59.99,
        marketPricesEur: [25.00, 27.00, 30.00],
        sourceAgreementCount: 1,
        isOfficialMerchant: false
      });

      expect(resMultiPeer.isAnomaly).toBe(true);
      expect(resMultiPeer.summary).toContain('Market outlier');
      expect(resMultiPeer.summary).toContain('€25.00');
    });

    it('Issue 16: Purchase advice guardrails prevent wild disagreement with DealScore', () => {
      const mockGame: Game = {
        id: 'g-test',
        steamAppId: 99999,
        title: 'Guardrail Test Game',
        slug: 'guardrail-test-game',
        basePriceEur: 59.99,
        bestPriceEur: 14.99,
        bestDiscountPercent: 75,
        bestDealScore: 85,
        bestDealTier: 'Exceptional',
        isDlc: false,
        isFree: false,
        hasPricingError: false,
        offersCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const mockOffer: Offer = {
        id: 'o-test',
        gameId: 'g-test',
        merchantId: 'm-1',
        merchantName: 'Steam',
        merchantCode: 'steam',
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        discountPercent: 75,
        dealUrl: 'https://store.steampowered.com',
        priceEvent: 'NONE',
        sources: [],
        isOfficial: true,
        isValid: true,
        isBestDeal: true,
        isLikelyPricingError: false,
        dealScore: 85,
        dealTier: 'Exceptional',
        lastObservedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const periodLows: PriceIntelligenceResponse['periodLows'] = {
        low7d: { priceEur: 14.99, observationCount: 1, isExactPeriodData: true },
        low30d: { priceEur: 14.99, observationCount: 1, isExactPeriodData: true },
        low90d: { priceEur: 14.99, observationCount: 1, isExactPeriodData: true },
        low1y: { priceEur: 14.99, observationCount: 1, isExactPeriodData: true },
        allTimeLow: { priceEur: 14.99, isConfirmed: true }
      };

      const typicalSale: TypicalSalePrice = {
        medianPriceEur: 29.99,
        q1PriceEur: 19.99,
        q3PriceEur: 39.99,
        sampleCount: 10,
        isLowConfidence: false
      };

      // 1. ActionSignal says WAIT (e.g. upcoming Steam sale in 5 days), but DealScore is 85
      const actionWait: ActionSignal = {
        decision: 'WAIT',
        badgeLabel: 'Wait (Steam Sale)',
        badgeColor: '#f59e0b',
        urgency: 'LOW',
        primaryReason: 'Steam Summer Sale in 5 days',
        timingContext: 'Recommended to wait'
      };

      const adviceHighDealScore = evaluatePurchaseAdvice(mockGame, mockOffer, periodLows, typicalSale, actionWait);
      // Guardrail upgrades from pure WAIT to FAIR because deal score is 85!
      expect(adviceHighDealScore.decision).toBe('FAIR');
      expect(adviceHighDealScore.confidence).toBe('MEDIUM');

      // 2. ActionSignal says BUY, but DealScore is terrible (<35)
      const poorOffer: Offer = { ...mockOffer, dealScore: 25, priceEur: 55.00 };
      const actionBuy: ActionSignal = {
        decision: 'BUY',
        badgeLabel: 'Buy',
        badgeColor: '#06b6d4',
        urgency: 'MEDIUM',
        primaryReason: 'Some trigger',
        timingContext: 'Some timing'
      };

      const adviceLowDealScore = evaluatePurchaseAdvice(mockGame, poorOffer, periodLows, typicalSale, actionBuy);
      // Guardrail clamps from BUY to FAIR with LOW confidence because deal score is 25!
      expect(adviceLowDealScore.decision).toBe('FAIR');
      expect(adviceLowDealScore.confidence).toBe('LOW');
    });
  });
});
