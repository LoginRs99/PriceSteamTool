import { describe, it, expect } from 'vitest';
import { evaluatePriceMovement, evaluateSourceOwnHistoryAnomaly } from '../../src/server/domain/pricingEngine.js';
import { calculateDealScore } from '../../src/server/domain/dealScore.js';
import { generateActionSignal } from '../../src/server/domain/actionSignal.js';

describe('2D Pricing Engine — Comprehensive Audit & Edge Cases Suite', () => {
  // -------------------------------------------------------------
  // Core 18 Scenarios
  // -------------------------------------------------------------
  
  it('1. €60 -> €40 official (normal publisher sale)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 40.00,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [39.99, 42.00]
    });

    expect(res.event).toBe('SIGNIFICANT_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.riskScore).toBeLessThan(0.20);
    expect(res.confidence).toBeGreaterThanOrEqual(0.70);
    expect(res.isAnomaly).toBe(false);
  });

  it('2. €60 -> €20 official (major publisher sale)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 20.00,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [20.00, 22.50]
    });

    expect(res.event).toBe('MAJOR_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('3. €60 -> €5 official (massive anniversary sale)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 5.00,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [5.00, 7.50]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('4. €60 -> €0.49 official (single source, potential store glitch)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.49,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: [45.00, 50.00]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('HIGH'); // Single source sub-euro drop is flagged as potential glitch anomaly
    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');
  });

  it('5. €60 -> €20 keyshop (legitimate keyshop market price)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 20.00,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 2,
      marketPricesEur: [21.00, 24.00]
    });

    expect(res.event).toBe('MAJOR_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('6. €60 -> €5 keyshop (deep keyshop discount, multi-source)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 5.00,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 2,
      marketPricesEur: [6.50, 8.00]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(['SAFE', 'LOW']).toContain(res.riskLevel);
    expect(res.isAnomaly).toBe(false);
  });

  it('7. €60 -> €2 keyshop (market is €40, single unverified outlier)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 2.00,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [38.00, 42.00, 40.00]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
    expect(res.riskFlags).toContain('EXTREME_MEDIAN_OUTLIER');
  });

  it('8. New historical low (official, single source)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 14.50,
      basePriceEur: 59.99,
      historicalLowEur: 18.00,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: [15.00, 18.00]
    });

    expect(['NEW_HISTORICAL_LOW', 'SUSPECTED_HISTORICAL_LOW']).toContain(res.event);
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('9. New historical low (3 sources confirmed)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 12.00,
      basePriceEur: 59.99,
      historicalLowEur: 18.00,
      isOfficialMerchant: true,
      sourceAgreementCount: 3,
      marketPricesEur: [12.00, 14.00, 15.00, 18.00]
    });

    expect(res.event).toBe('NEW_HISTORICAL_LOW');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
    expect(res.isAnomaly).toBe(false);
  });

  it('10. Legitimate official sale dropping below historical low', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 9.99,
      basePriceEur: 39.99,
      historicalLowEur: 12.50,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [10.50, 12.00]
    });

    expect(res.event).toBe('NEW_HISTORICAL_LOW');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('11. Single-source extreme price anomaly', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 1.50,
      basePriceEur: 49.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [35.00, 40.00]
    });

    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
    expect(res.confidence).toBeLessThan(0.60);
  });

  it('12. Multi-source extreme price (3 sources agree)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 3.99,
      basePriceEur: 39.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 3,
      marketPricesEur: [4.00, 4.20, 5.00]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('13. Source disagreement check', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 18.00,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [30.00, 50.00]
    });

    expect(res.riskFlags).toContain('SOURCE_DISAGREEMENT');
    expect(['LOW', 'MEDIUM']).toContain(res.riskLevel);
    expect(res.riskLevel).not.toBe('HIGH');
  });

  it('14. Fresh release unexpected huge price drop', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 12.00,
      basePriceEur: 69.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      gameReleaseDate: new Date(Date.now() - 15 * 86400000).toISOString(), // 15 days old
      marketPricesEur: [60.00, 65.00]
    });

    expect(res.riskFlags).toContain('FRESH_RELEASE_UNEXPECTED_DROP');
    expect(['MEDIUM', 'HIGH']).toContain(res.riskLevel);
  });

  it('15. Old game (6 years) 90% discount', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 2.99,
      basePriceEur: 29.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      gameReleaseDate: new Date(Date.now() - 2000 * 86400000).toISOString(),
      marketPricesEur: [3.00, 3.50]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('16. Cheap game €5 -> €1 drop is NOT treated as AAA catastrophe', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 1.00,
      basePriceEur: 4.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [1.20, 2.00]
    });

    expect(res.event).toBe('SIGNIFICANT_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('17. Stale observation reduces confidence but does NOT inflate risk', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 19.99,
      basePriceEur: 49.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      isStaleObservation: true
    });

    expect(res.riskLevel).toBe('SAFE'); // Price itself is not high risk
    expect(res.confidence).toBeLessThanOrEqual(0.40); // Confidence is penalized
    expect(res.riskFlags).toContain('STALE_OBSERVATION');
  });

  it('18. Missing MSRP anchor', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 19.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1
    });

    expect(res.event).toBe('NONE');
    expect(res.confidence).toBeLessThan(0.40);
    expect(res.riskFlags).toContain('MISSING_MSRP_ANCHOR');
  });

  // -------------------------------------------------------------
  // Extended Edge Cases
  // -------------------------------------------------------------

  it('19. Official store + 3 sources + 95% discount is verified safe', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 2.50,
      basePriceEur: 49.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 3,
      marketPricesEur: [2.50, 3.00, 3.50]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('20. Keyshop + 3 sources + 80% discount', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 10.00,
      basePriceEur: 49.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 3,
      marketPricesEur: [10.50, 11.00]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(['SAFE', 'LOW']).toContain(res.riskLevel);
  });

  it('21. Free to play game (0.00 €)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.00,
      basePriceEur: 0.00,
      isOfficialMerchant: true,
      sourceAgreementCount: 2
    });

    expect(res.event).toBe('NONE');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.riskScore).toBe(0.0);
  });

  it('22. Price increase compared to previous observation', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 29.99,
      previousPriceEur: 19.99,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2
    });

    expect(res.event).toBe('PRICE_INCREASE');
    expect(res.riskLevel).toBe('SAFE');
  });

  it('23. Mathematical bounds verification: scores always between 0 and 1', () => {
    const testCases: any[] = [
      { currentPriceEur: 0.01, basePriceEur: 99.99, isOfficialMerchant: false, sourceAgreementCount: 1, marketPricesEur: [80, 90] },
      { currentPriceEur: 50.00, basePriceEur: 50.00, isOfficialMerchant: true, sourceAgreementCount: 4, marketPricesEur: [50, 50, 50, 50] },
      { currentPriceEur: 100.00, basePriceEur: 10.00, isOfficialMerchant: false, sourceAgreementCount: 1 }
    ];

    for (const tc of testCases) {
      const res = evaluatePriceMovement(tc);
      expect(res.riskScore).toBeGreaterThanOrEqual(0.0);
      expect(res.riskScore).toBeLessThanOrEqual(1.0);
      expect(res.confidence).toBeGreaterThanOrEqual(0.10);
      expect(res.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  // -------------------------------------------------------------
  // Phase 1: Ratio-Based Anomaly & Budget/Mid-Tier (€5-15) Tests
  // -------------------------------------------------------------

  it('24. Budget game (€9.75 MSRP) with extreme ratio drop (Zero Hour case: €0.30, 3% of MSRP)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.30,
      basePriceEur: 9.75,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [3.40, 4.50, 8.00]
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskFlags).toContain('EXTREME_MEDIAN_OUTLIER');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
  });

  it('25. Mid-tier game (€12.00 MSRP) with extreme ratio drop < 5% of MSRP (€0.50)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 12.00,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [6.00, 8.00, 10.00]
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskLevel).toBe('HIGH');
  });

  it('26. Gatekeeper case: Low median (€3.40) with severe outlier (€0.60, < 25% of median)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.60,
      basePriceEur: 12.50,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [3.20, 3.40, 4.00]
    });

    expect(res.riskFlags).toContain('EXTREME_MEDIAN_OUTLIER');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
  });

  it('27. Historical low discrepancy on budget title (historicalLow = €3.50, price = €0.50)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 10.00,
      historicalLowEur: 3.50,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [3.00, 3.50]
    });

    expect(res.riskFlags).toContain('HISTORICAL_LOW_DISCREPANCY');
  });

  it('28. 4 live offers within 20% of each other -> none reach HIGH risk (tight keyshop market cluster)', () => {
    const offers = [1.06, 1.11, 1.22, 1.26];
    
    for (const price of offers) {
      const otherPrices = offers.filter(p => p !== price);
      const res = evaluatePriceMovement({
        currentPriceEur: price,
        basePriceEur: 19.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        marketPricesEur: otherPrices
      });

      expect(res.riskLevel).not.toBe('HIGH');
      expect(res.isAnomaly).toBe(false);
      expect(res.riskFlags).not.toContain('LONE_BOTTOM_OUTLIER');
    }
  });

  it('29. One offer 50%+ below the next-cheapest live offer -> LONE_BOTTOM_OUTLIER fires and reaches HIGH risk', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 1.20,
      basePriceEur: 29.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [3.50, 4.00, 4.20]
    });

    expect(res.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
  });

  it('30. Sub-€1 offer with no marketPricesEur peers at all -> reaches HIGH risk with SUB_EURO_PREMIUM_GLITCH', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: []
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskFlags).not.toContain('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
  });

  it('31. Sub-€1 offer with one peer 60%+ away (no corroboration) -> reaches HIGH risk with SUB_EURO_PREMIUM_GLITCH', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [1.20] // (1.20 - 0.50) / 0.50 = 140% away
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskFlags).not.toContain('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    expect(res.riskLevel).toBe('HIGH');
    expect(res.isAnomaly).toBe(true);
  });

  it('32. Sub-€1 offer with a peer within 30% -> does NOT reach HIGH risk, flag is SUB_EURO_PREMIUM_GLITCH_CORROBORATED', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [0.60] // (0.60 - 0.50) / 0.50 = 20% away
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    expect(res.riskFlags).not.toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskLevel).not.toBe('HIGH');
    expect(res.isAnomaly).toBe(false);
  });

  it('33. Sub-€1 offer with a peer at exactly the 30% boundary -> corroborated (inclusive <= boundary)', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.50,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [0.65] // (0.65 - 0.50) / 0.50 = exactly 30%
    });

    expect(res.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    expect(res.riskFlags).not.toContain('SUB_EURO_PREMIUM_GLITCH');
    expect(res.riskLevel).not.toBe('HIGH');
    expect(res.isAnomaly).toBe(false);
  });

  // -------------------------------------------------------------
  // Per-Source Own History Anomaly Check & Peer Fallback Suite
  // -------------------------------------------------------------
  describe('Per-Source Own History Anomaly Check & Fallback', () => {
    it('34. evaluateSourceOwnHistoryAnomaly returns applicable: false when fewer than 3 observations', () => {
      const emptyRes = evaluateSourceOwnHistoryAnomaly(10.00, []);
      expect(emptyRes.applicable).toBe(false);
      expect(emptyRes.isBreak).toBe(false);
      expect(emptyRes.zScore).toBeNull();
      expect(emptyRes.ownMedian).toBeNull();

      const twoObsRes = evaluateSourceOwnHistoryAnomaly(10.00, [10.00, 10.50]);
      expect(twoObsRes.applicable).toBe(false);
      expect(twoObsRes.isBreak).toBe(false);
    });

    it('35. evaluateSourceOwnHistoryAnomaly returns applicable: true for exactly 3 observations (boundary)', () => {
      const res = evaluateSourceOwnHistoryAnomaly(13.00, [13.00, 13.50, 12.80]);
      expect(res.applicable).toBe(true);
      expect(res.isBreak).toBe(false);
      expect(res.ownMedian).toBe(13.00);
      expect(res.zScore).toBeDefined();
    });

    it('36. Gears 5 case: merchant with 3+ stable observations matching current price -> SOURCE_OWN_HISTORY_BREAK does not fire and peer flags suppressed', () => {
      // Keyshop consistently sells at ~€13, current price is €12.80. Official store peer is €39.99.
      const res = evaluatePriceMovement({
        currentPriceEur: 12.80,
        basePriceEur: 39.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        sourceHistoryEur: [12.99, 13.49, 13.10], // 3 prior observations ~€13
        marketPricesEur: [39.99] // Official store peer is 3x higher (would trigger LONE_BOTTOM_OUTLIER if peer-based)
      });

      expect(res.riskFlags).not.toContain('SOURCE_OWN_HISTORY_BREAK');
      expect(res.riskFlags).not.toContain('LONE_BOTTOM_OUTLIER');
      expect(res.riskFlags).not.toContain('EXTREME_MEDIAN_OUTLIER');
      expect(res.riskFlags).not.toContain('SOURCE_DISAGREEMENT');
      expect(res.riskLevel).not.toBe('HIGH');
      expect(res.isAnomaly).toBe(false);
    });

    it('37. Blue Prince / DOOM 3 case: merchant with 3+ stable observations near MSRP suddenly near-zero -> SOURCE_OWN_HISTORY_BREAK fires at HIGH severity', () => {
      // Merchant was consistently ~€19.99, suddenly drops to €0.11
      const res = evaluatePriceMovement({
        currentPriceEur: 0.11,
        basePriceEur: 19.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        sourceHistoryEur: [19.99, 19.99, 18.99, 19.99], // Stable near ~€19.99
        marketPricesEur: [19.99]
      });

      expect(res.riskFlags).toContain('SOURCE_OWN_HISTORY_BREAK');
      expect(res.riskLevel).toBe('HIGH');
      expect(res.isAnomaly).toBe(true);
    });

    it('38. Fallback path: fewer than 3 own observations -> peer-based LONE_BOTTOM_OUTLIER fires as before', () => {
      // Only 1 prior observation -> not applicable for own-history check -> fallback peer check runs
      const res = evaluatePriceMovement({
        currentPriceEur: 10.00,
        basePriceEur: 59.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        sourceHistoryEur: [10.00], // < 3 observations
        marketPricesEur: [45.00] // Second cheapest is €45 -> 10 < 45 * 0.55
      });

      expect(res.riskFlags).not.toContain('SOURCE_OWN_HISTORY_BREAK');
      expect(res.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
      expect(res.riskLevel).toBe('HIGH');
      expect(res.isAnomaly).toBe(true);
    });

    it('39. Zero-price history: free game history (0€) evaluates cleanly without division by zero', () => {
      const res = evaluateSourceOwnHistoryAnomaly(0.00, [0.00, 0.00, 0.00]);
      expect(res.applicable).toBe(true);
      expect(res.isBreak).toBe(false);
      expect(res.zScore).toBe(0);
      expect(res.ownMedian).toBe(0);
    });
  });

  describe('Keyshop Policy Compliance', () => {
    it('1. ordinary keyshop price (Official 10€, Keyshop 9.50€) is not generically penalized', () => {
      const keyshopRes = evaluatePriceMovement({
        currentPriceEur: 9.50,
        basePriceEur: 20.00,
        isOfficialMerchant: false,
        sourceAgreementCount: 2,
        marketPricesEur: [10.00]
      });

      expect(keyshopRes.riskLevel).toBe('SAFE');
      expect(keyshopRes.isAnomaly).toBe(false);
    });

    it('2. corroborated keyshop price remains legitimate and safe', () => {
      const keyshopRes = evaluatePriceMovement({
        currentPriceEur: 15.00,
        basePriceEur: 30.00,
        isOfficialMerchant: false,
        sourceAgreementCount: 3,
        marketPricesEur: [15.50, 16.00]
      });

      expect(keyshopRes.riskLevel).toBe('SAFE');
      expect(keyshopRes.isAnomaly).toBe(false);
    });

    it('3. single-source uncorroborated keyshop can be treated cautiously based on evidence', () => {
      const keyshopRes = evaluatePriceMovement({
        currentPriceEur: 10.00,
        basePriceEur: 59.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 1,
        marketPricesEur: [45.00] // Single source keyshop 10€ vs 45€ peers -> LONE_BOTTOM_OUTLIER
      });

      expect(keyshopRes.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
      expect(keyshopRes.riskLevel).toBe('HIGH');
    });

    it('4. keyshop status alone does NOT trigger anomaly', () => {
      const keyshopRes = evaluatePriceMovement({
        currentPriceEur: 19.99,
        basePriceEur: 29.99,
        isOfficialMerchant: false,
        sourceAgreementCount: 2,
        marketPricesEur: [20.00]
      });

      expect(keyshopRes.isAnomaly).toBe(false);
      expect(keyshopRes.riskLevel).toBe('SAFE');
    });
  });

  describe('Anomaly V2 Compliance', () => {
    it('5. market-wide deep discount (30€ -> 18€, 15€, 14€, 12€) is NOT anomaly', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 12.00,
        basePriceEur: 30.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 3,
        marketPricesEur: [18.00, 15.00, 14.00]
      });

      expect(res.isAnomaly).toBe(false);
      expect(res.riskLevel).not.toBe('HIGH');
    });

    it('6. lone extreme outlier (30€, 29€, 28€, 27€ vs 3€) IS anomaly', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 3.00,
        basePriceEur: 30.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        marketPricesEur: [27.00, 28.00, 29.00]
      });

      expect(res.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
      expect(res.isAnomaly).toBe(true);
      expect(res.riskLevel).toBe('HIGH');
    });

    it('7. second-lowest divergence is detected (LONE_BOTTOM_OUTLIER)', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 5.00,
        basePriceEur: 50.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        marketPricesEur: [25.00] // 5.00 < 25.00 * 0.55
      });

      expect(res.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
      expect(res.isAnomaly).toBe(true);
    });

    it('8. own-history extreme break is detected (SOURCE_OWN_HISTORY_BREAK)', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 1.50,
        basePriceEur: 30.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        sourceHistoryEur: [25.00, 27.00, 26.00, 28.00],
        marketPricesEur: [28.00]
      });

      expect(res.riskFlags).toContain('SOURCE_OWN_HISTORY_BREAK');
      expect(res.isAnomaly).toBe(true);
      expect(res.riskLevel).toBe('HIGH');
    });

    it('9. multiple corroborated low prices reduce anomaly likelihood', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 8.00,
        basePriceEur: 40.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 3, // 3+ corroborating sources
        marketPricesEur: [8.50, 9.00]
      });

      expect(res.isAnomaly).toBe(false);
      expect(res.riskLevel).toBe('SAFE');
    });

    it('10. large MSRP discount alone (60€ -> 4.99€ on official store with 2+ sources) does NOT trigger anomaly', () => {
      const res = evaluatePriceMovement({
        currentPriceEur: 4.99,
        basePriceEur: 60.00,
        isOfficialMerchant: true,
        sourceAgreementCount: 2,
        marketPricesEur: [5.49]
      });

      expect(res.isAnomaly).toBe(false);
      expect(res.riskLevel).not.toBe('HIGH');
    });

    it('11. anomaly does NOT erase underlying Deal Score', () => {
      const dealCalc = calculateDealScore({
        priceEur: 3.00,
        typicalSaleMedianEur: 30.00,
        allTimeLowEur: 20.00,
        isAnomaly: true
      });

      // Deal score is calculated purely from price & median, ignoring anomaly status
      expect(dealCalc.score).toBeGreaterThanOrEqual(65);
    });

    it('12. anomalous offer produces PROVISIONAL decision in Action Signal', () => {
      const signal = generateActionSignal({
        dealScore: 90,
        confidenceScore: 70,
        isProvisional: false,
        isAnomaly: true,
        currentPriceEur: 3.00,
        typicalSaleMedianEur: 30.00
      });

      expect(signal.decision).toBe('PROVISIONAL');
      expect(signal.badgeLabel).toBe('Flagged Anomaly');
    });
  });
});
