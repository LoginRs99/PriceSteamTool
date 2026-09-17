import { describe, it, expect } from 'vitest';
import { calculateDealScore } from '../../src/server/domain/dealScore/calculator.js';
import { getDealScoreTier } from '../../src/server/domain/dealScore/tiers.js';
import { detectPricingError } from '../../src/server/domain/pricingError/detector.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingError/index.js';

/**
 * Comprehensive Test Suite:
 * Part 1: 15 Distinct Real-World Game Scenarios for Deal Score Engine
 * Part 2: Genuine Price Errors/Glitches vs Legitimate Normal Sales for Anomaly Detection Engine
 */

describe('Part 1: 15 Games Deal Score Benchmark Suite', () => {
  // Game 1: The Witcher 3: Wild Hunt — Deep ATL Break on Legendary Title
  it('Game 1: The Witcher 3 — All-Time Low Break scores in Great/Exceptional tier', () => {
    const res = calculateDealScore({
      priceEur: 3.99,
      basePriceEur: 29.99,
      allTimeLowEur: 5.99, // Current price breaks old ATL of €5.99
      typicalSaleMedianEur: 8.99,
      minOfferEur: 3.99,
      maxOfferEur: 29.99,
      offersCount: 5,
      sampleCount: 24
    });

    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.tier).toMatch(/Great|Exceptional/);
    expect(res.verdict).toBe('INSTANT_BUY');
    expect(res.components?.atlProximity).toBe(40); // Max ATL points (match + undercut bonus)
    expect(res.components?.discountDepth).toBeGreaterThan(20);
  });

  // Game 2: Cyberpunk 2077 — Standard Recurring 50% Sale at Historical Median
  it('Game 2: Cyberpunk 2077 — Typical sale at median produces Good/Fair score without inflation', () => {
    const res = calculateDealScore({
      priceEur: 29.99,
      basePriceEur: 59.99,
      allTimeLowEur: 24.99,
      typicalSaleMedianEur: 29.99, // Matches historical sale median exactly
      minOfferEur: 29.99,
      maxOfferEur: 59.99,
      offersCount: 4,
      sampleCount: 18
    });

    expect(res.score).toBeGreaterThanOrEqual(45);
    expect(res.score).toBeLessThanOrEqual(75);
    expect(res.verdict).toBe('FAIR_DEAL');
    expect(res.components?.historicalValue).toBe(0); // 0 extra points when price is at median ceiling of sale band
  });

  // Game 3: Elden Ring — Full MSRP / Zero Discount
  it('Game 3: Elden Ring — Full MSRP receives Weak score and WAIT verdict', () => {
    const res = calculateDealScore({
      priceEur: 59.99,
      basePriceEur: 59.99,
      allTimeLowEur: 35.99,
      typicalSaleMedianEur: 41.99,
      minOfferEur: 59.99,
      maxOfferEur: 59.99,
      offersCount: 1,
      sampleCount: 12
    });

    expect(res.score).toBeLessThanOrEqual(25);
    expect(res.tier).toBe('Weak');
    expect(res.verdict).toBe('WAIT');
    expect(res.components?.atlProximity).toBe(0);
    expect(res.components?.discountDepth).toBe(0);
  });

  // Game 4: Hades — Exact ATL Match with Full Market Agreement
  it('Game 4: Hades — Exact ATL match gets full S_atl base (36) and high overall score', () => {
    const res = calculateDealScore({
      priceEur: 8.19,
      basePriceEur: 24.50,
      allTimeLowEur: 8.19, // Exact match
      typicalSaleMedianEur: 12.25,
      minOfferEur: 8.19,
      maxOfferEur: 24.50,
      offersCount: 5,
      sampleCount: 20
    });

    expect(res.components?.atlProximity).toBe(36); // Base match points
    expect(res.score).toBeGreaterThanOrEqual(75);
    expect(res.verdict).toBe('INSTANT_BUY');
  });

  // Game 5: Balatro — New Indie with Limited History (< 5 samples)
  it('Game 5: Balatro — Insufficient history applies provisional cap (<= 65)', () => {
    const res = calculateDealScore({
      priceEur: 11.83, // 20% off
      basePriceEur: 14.79,
      allTimeLowEur: 11.83,
      typicalSaleMedianEur: 13.50,
      minOfferEur: 11.83,
      maxOfferEur: 14.79,
      offersCount: 3,
      sampleCount: 2 // Low sample count!
    });

    expect(res.isProvisional).toBe(true);
    expect(res.isLowSample).toBe(true);
    expect(res.score).toBeLessThanOrEqual(65); // Capped by provisional safety rule
    expect(res.confidenceTier).toBe('Low');
  });

  // Game 6: Terraria — Budget Classic with Sub-Euro FX Spread
  it('Game 6: Terraria — Tight FX rounding spread (0.01 EUR) awards full market score', () => {
    const res = calculateDealScore({
      priceEur: 4.99,
      basePriceEur: 9.99,
      allTimeLowEur: 4.99,
      typicalSaleMedianEur: 4.99,
      minOfferEur: 4.98, // Within 0.02 EUR FX rounding spread
      maxOfferEur: 5.00,
      offersCount: 6,
      sampleCount: 30
    });

    expect(res.components?.marketPosition).toBe(10); // Full S_mkt points despite 0.01 FX noise
    expect(res.score).toBeGreaterThanOrEqual(70);
  });

  // Game 7: Baldur\'s Gate 3 — First Modest 20% Sale on Never-Deeply-Discounted Game
  it('Game 7: Baldur\'s Gate 3 — Modest percentage discount that equals ATL gets rewarded', () => {
    const res = calculateDealScore({
      priceEur: 47.99,
      basePriceEur: 59.99,
      allTimeLowEur: 47.99,
      typicalSaleMedianEur: 59.99,
      minOfferEur: 47.99,
      maxOfferEur: 59.99,
      offersCount: 3,
      sampleCount: 10
    });

    expect(res.components?.atlProximity).toBe(36);
    expect(res.score).toBeGreaterThanOrEqual(65);
    expect(res.verdict).toBe('GREAT_DEAL');
  });

  // Game 8: Factorio — Never-On-Sale Title with Slight Store Variance
  it('Game 8: Factorio — Minor 5% difference on strict non-discount game scored correctly', () => {
    const res = calculateDealScore({
      priceEur: 30.40,
      basePriceEur: 32.00,
      allTimeLowEur: 32.00,
      typicalSaleMedianEur: 32.00,
      minOfferEur: 30.40,
      maxOfferEur: 32.00,
      offersCount: 3,
      sampleCount: 15
    });

    expect(res.score).toBeGreaterThanOrEqual(40);
    expect(res.score).toBeLessThanOrEqual(75);
    expect(res.verdict).toBe('GREAT_DEAL');
  });

  // Game 9: The Elder Scrolls V: Skyrim SE — Frequent 80% Discount
  it('Game 9: Skyrim SE — Deep 80% discount matching median and ATL scores strongly', () => {
    const res = calculateDealScore({
      priceEur: 7.99,
      basePriceEur: 39.99,
      allTimeLowEur: 7.99,
      typicalSaleMedianEur: 9.99,
      minOfferEur: 7.99,
      maxOfferEur: 39.99,
      offersCount: 5,
      sampleCount: 25
    });

    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.verdict).toBe('INSTANT_BUY');
  });

  // Game 10: Hollow Knight — Keyshop Competitive Edge vs Official
  it('Game 10: Hollow Knight — Keyshop beating official store scores maximum market points', () => {
    const res = calculateDealScore({
      priceEur: 5.50,
      basePriceEur: 14.79,
      allTimeLowEur: 5.50,
      typicalSaleMedianEur: 7.39,
      minOfferEur: 5.50,
      maxOfferEur: 14.79,
      offersCount: 4,
      sampleCount: 20
    });

    expect(res.components?.marketPosition).toBe(10);
    expect(res.score).toBeGreaterThanOrEqual(80);
  });

  // Game 11: Red Dead Redemption 2 — Premium Blockbuster 67% Off
  it('Game 11: RDR2 — Deep discount below median to ATL gets High tier', () => {
    const res = calculateDealScore({
      priceEur: 19.79,
      basePriceEur: 59.99,
      allTimeLowEur: 19.79,
      typicalSaleMedianEur: 29.99,
      minOfferEur: 19.79,
      maxOfferEur: 59.99,
      offersCount: 5,
      sampleCount: 16
    });

    expect(res.score).toBeGreaterThanOrEqual(80);
    expect(res.tier).toMatch(/Great|Exceptional/);
  });

  // Game 12: Stardew Valley — Slightly Above Historic ATL (+€2.00)
  it('Game 12: Stardew Valley — Price €2 above ATL scores Fair/Good without false penalty', () => {
    const res = calculateDealScore({
      priceEur: 9.99,
      basePriceEur: 13.99,
      allTimeLowEur: 7.99,
      typicalSaleMedianEur: 9.99,
      minOfferEur: 9.99,
      maxOfferEur: 13.99,
      offersCount: 3,
      sampleCount: 20
    });

    expect(res.score).toBeGreaterThanOrEqual(30);
    expect(res.score).toBeLessThan(70);
    expect(res.verdict).toMatch(/BUY_NOW|CONSIDER|WAIT/);
  });

  // Game 13: Monster Hunter: World — Crushing Stale ATL by 34%
  it('Game 13: Monster Hunter: World — Undercutting ATL by >15% earns maximum undercut bonus (4 pts)', () => {
    const res = calculateDealScore({
      priceEur: 9.89,
      basePriceEur: 29.99,
      allTimeLowEur: 14.99, // Old ATL was €14.99, now €9.89 (34% undercut)
      typicalSaleMedianEur: 14.99,
      minOfferEur: 9.89,
      maxOfferEur: 29.99,
      offersCount: 5,
      sampleCount: 22
    });

    expect(res.components?.atlProximity).toBe(40); // 36 base + 4 full undercut bonus
    expect(res.score).toBeGreaterThanOrEqual(85);
  });

  // Game 14: Euro Truck Simulator 2 — Stale ATL > Median Reconciliation
  it('Game 14: ETS2 — Stale recorded ATL > median reconciles gracefully without NaN', () => {
    const res = calculateDealScore({
      priceEur: 4.99,
      basePriceEur: 19.99,
      allTimeLowEur: 9.99, // Stale recorded ATL higher than typical sale median
      typicalSaleMedianEur: 4.99,
      minOfferEur: 4.99,
      maxOfferEur: 19.99,
      offersCount: 4,
      sampleCount: 18
    });

    expect(isNaN(res.score)).toBe(false);
    expect(res.score).toBeGreaterThanOrEqual(60);
    expect(res.components?.historicalValue).toBe(20);
  });

  // Game 15: Grand Theft Auto V — Flagged Pricing Error Offer Protection
  it('Game 15: GTA V — Offer marked as pricing error returns score 0 and WAIT verdict', () => {
    const res = calculateDealScore({
      priceEur: 0.99, // Glitched price
      basePriceEur: 29.98,
      allTimeLowEur: 14.98,
      typicalSaleMedianEur: 14.98,
      isPricingError: true // Safety pipeline flagged this offer!
    });

    expect(res.score).toBe(0);
    expect(res.verdict).toBe('WAIT');
    expect(res.components?.atlProximity).toBe(0);
    expect(res.components?.discountDepth).toBe(0);
  });
});

describe('Part 2: Anomaly & Pricing Error Detection Suite', () => {
  describe('Group A: Genuine Price Glitches & Errors (MUST BE FLAGGED)', () => {
    it('Glitch 1: Minecraft Legends — Sub-euro pricing error (€0.74 vs €18.90 official peer, 25x ratio)', () => {
      const evalResult = detectPricingError({
        priceEur: 0.74,
        steamBasePriceEur: 39.99,
        otherFreshPricesEur: [18.90, 19.99, 20.50],
        sourceFamilyConflict: {
          ratio: 25.54,
          details: 'Keyshop €0.74 vs Official €18.90'
        }
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toMatch(/SOURCE_FAMILY_CONFLICT|DECIMAL_SHIFT|MARKET_OUTLIER/);
      expect(evalResult.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it('Glitch 2: Until Then — Sub-euro price glitch on premium title (€0.59 on €19.99 MSRP)', () => {
      const evalResult = detectPricingError({
        priceEur: 0.59,
        steamBasePriceEur: 19.99,
        otherFreshPricesEur: [14.99, 15.20, 16.00],
        isOfficialMerchant: false
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('DECIMAL_SHIFT');
      expect(evalResult.reason).toContain('Sub-euro');
    });

    it('Glitch 3: STAR WARS Dark Forces Remaster — Extreme 14x conflict (€1.86 vs €25.99 official)', () => {
      const evalResult = detectPricingError({
        priceEur: 1.86,
        steamBasePriceEur: 29.99,
        otherFreshPricesEur: [25.99, 26.50],
        sourceFamilyConflict: {
          ratio: 13.97,
          details: 'Keyshop €1.86 vs Official €25.99'
        }
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('SOURCE_FAMILY_CONFLICT');
    });

    it('Glitch 4: Gatekeeper — Lone bottom outlier with big price gap (€0.46 vs €8.01)', () => {
      const evalResult = detectPricingError({
        priceEur: 0.46,
        steamBasePriceEur: 12.99,
        otherFreshPricesEur: [8.01, 8.50, 9.00]
      });

      // 0.46 < 8.01 * 0.55 (= 4.40) and gap is 8.01 - 0.46 = 7.55 >= 2.00
      expect(evalResult.isLikelyPricingError).toBe(true);
    });

    it('Glitch 5: Final Fantasy XII — Lone bottom outlier meeting 0.55 threshold (€12.25 vs €43.33)', () => {
      const evalResult = detectPricingError({
        priceEur: 12.25,
        steamBasePriceEur: 49.99,
        otherFreshPricesEur: [43.33, 44.00, 45.00],
        isOfficialMerchant: false
      });

      // 12.25 < 43.33 * 0.55 (= 23.83) and gap is €31.08 >= 2.00
      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('MARKET_OUTLIER');
    });

    it('Glitch 6: Cyberpunk 2077 — Missing digit shift (€5.99 on €59.99 MSRP when market is near full price)', () => {
      const evalResult = detectPricingError({
        priceEur: 5.99,
        steamBasePriceEur: 59.99,
        otherFreshPricesEur: [59.99, 59.99],
        typicalSaleMedianEur: 29.99,
        confirmedAtlEur: 24.99
      });

      // Ratio is 0.10 (1/10 missing digit), market min is 59.99 >= msrp * 0.60
      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('DECIMAL_SHIFT');
    });

    it('Glitch 7: Elden Ring — Extreme >95% drop on premium title (€1.00 vs €59.99)', () => {
      const evalResult = detectPricingError({
        priceEur: 1.00,
        steamBasePriceEur: 59.99,
        otherFreshPricesEur: [49.99, 54.99, 59.99]
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('DECIMAL_SHIFT');
    });

    it('Glitch 8: Fake Baseline Scam — Claimed original €120.00 vs Steam base €27.99 with discount', () => {
      const evalResult = detectPricingError({
        priceEur: 14.99,
        steamBasePriceEur: 27.99,
        claimedOriginalPriceEur: 120.00, // > 1.5x of Steam base
        otherFreshPricesEur: [19.99, 21.00]
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('FAKE_BASELINE');
    });

    it('Glitch 9: Edition Inversion — Suspected deluxe bundle cheaper than base edition', () => {
      const evalResult = detectPricingError({
        priceEur: 12.99,
        steamBasePriceEur: 19.99,
        suspectedEditionInversion: true
      });

      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('EDITION_INVERSION');
    });

    it('Glitch 10: Extreme Lone Outlier — Keyshop offer < 55% of cheapest peer with >= €2 gap', () => {
      const evalResult = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 29.99,
        otherFreshPricesEur: [20.00, 21.00, 22.00],
        isOfficialMerchant: false
      });

      // 5.00 < 20.00 * 0.55 (= 11.00) and gap is 15.00 >= 2.00
      expect(evalResult.isLikelyPricingError).toBe(true);
      expect(evalResult.type).toBe('MARKET_OUTLIER');
    });
  });

  describe('Group B: Legitimate Normal Market Sales (MUST NEVER BE FLAGGED)', () => {
    it('Legitimate 1: Terminator Resistance — Clustered market prices produce ZERO pricing errors', () => {
      // Live scenario: Steam €7.35, GG.deals Official €7.99, GG.deals Keyshops €8.15, GAMESEAL €8.28, GAMIVO €8.68
      const offers = [
        { name: 'Steam Store', price: 7.35, isOfficial: true },
        { name: 'GG.deals Official', price: 7.99, isOfficial: true },
        { name: 'GG.deals Keyshops', price: 8.15, isOfficial: false },
        { name: 'GAMESEAL', price: 8.28, isOfficial: false },
        { name: 'GAMIVO', price: 8.68, isOfficial: false }
      ];

      for (const o of offers) {
        const otherPrices = offers.filter(x => x.name !== o.name).map(x => x.price);
        const evalResult = detectPricingError({
          priceEur: o.price,
          steamBasePriceEur: 39.99,
          otherFreshPricesEur: otherPrices,
          typicalSaleMedianEur: 24.99, // Own history was €24.99, but market is €7-8
          isOfficialMerchant: o.isOfficial
        });

        // NOT an anomaly! Corroborated market sale
        expect(evalResult.isLikelyPricingError).toBe(false);
      }
    });

    it('Legitimate 2: Hitman Contracts — Official store budget publisher sale (€0.89 on €8.99 MSRP)', () => {
      const evalResult = detectPricingError({
        priceEur: 0.89,
        steamBasePriceEur: 8.99,
        otherFreshPricesEur: [0.89, 1.20, 1.50],
        isOfficialMerchant: true
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 3: Final Fantasy IV — Deluxe/Complete bundle selling above base price (€74.82 vs €17.99)', () => {
      const evalResult = detectPricingError({
        priceEur: 74.82,
        steamBasePriceEur: 17.99,
        claimedOriginalPriceEur: 89.99,
        isOfficialMerchant: true
      });

      // Price >= steamBasePriceEur, not a fake baseline discount glitch!
      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 4: Rain World — Standard keyshop discount ratio (3.46x < 5.0) is not an error', () => {
      const evalResult = detectPricingError({
        priceEur: 1.73,
        steamBasePriceEur: 24.50,
        otherFreshPricesEur: [1.85, 2.10, 5.99],
        sourceFamilyConflict: {
          ratio: 3.46, // Keyshop €1.73 vs Official €5.99 -> ratio 3.46x
          details: 'Keyshop €1.73 vs Official €5.99'
        }
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 5: Gears 5 — Standard keyshop spread with market peers (€13.25 vs €15.99 keyshop, €25.99 official)', () => {
      const evalResult = detectPricingError({
        priceEur: 13.25,
        steamBasePriceEur: 39.99,
        otherFreshPricesEur: [15.99, 25.99, 29.99],
        sourceFamilyConflict: {
          ratio: 1.96,
          details: 'Keyshop €13.25 vs Official €25.99'
        }
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 6: Ninja Gaiden 4 — Keyshop at €28.71 with peer corroboration (€34.99, €59.49)', () => {
      const evalResult = detectPricingError({
        priceEur: 28.71,
        steamBasePriceEur: 69.99,
        otherFreshPricesEur: [34.99, 59.49, 60.66],
        sourceFamilyConflict: {
          ratio: 2.07,
          details: 'Keyshop €28.71 vs Official €59.49'
        }
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 7: Market-Wide Publisher Sale (€8, €9, €10, €11, €12 on €40 MSRP)', () => {
      const peers = [9.00, 10.00, 11.00, 12.00];
      const evalResult = detectPricingError({
        priceEur: 8.00,
        steamBasePriceEur: 40.00,
        otherFreshPricesEur: peers
      });

      // 8.00 >= 9.00 * 0.55 (= 4.95) -> NOT an outlier!
      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 8: Small gap cheapest offer (€3.80 vs €3.89, €4.09, €4.14)', () => {
      const peers = [3.89, 4.09, 4.14, 4.16, 4.21];
      const evalResult = detectPricingError({
        priceEur: 3.80,
        steamBasePriceEur: 19.99,
        otherFreshPricesEur: peers
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 9: Authorized Publisher Sale on Official Store (GMG at €4.50 with peers €4.99, €5.50)', () => {
      const evalResult = detectPricingError({
        priceEur: 4.50,
        steamBasePriceEur: 29.99,
        otherFreshPricesEur: [4.99, 5.50],
        isOfficialMerchant: true // Authorized official retailer
      });

      expect(evalResult.isLikelyPricingError).toBe(false);
    });

    it('Legitimate 10: Keyshop corroborated by other peers in market within 20%', () => {
      // Keyshop A is €5.00, Keyshop B is €5.20, Official is €20.00
      const evalResult = detectPricingError({
        priceEur: 5.00,
        steamBasePriceEur: 29.99,
        otherFreshPricesEur: [5.20, 5.50, 20.00]
      });

      // 5.00 is corroborated by 5.20 (gap is only 0.20 EUR, not lone outlier)
      expect(evalResult.isLikelyPricingError).toBe(false);
    });
  });
});
