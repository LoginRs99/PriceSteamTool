import { describe, it, expect } from 'vitest';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine.js';

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
    expect(res.riskLevel).toBe('MEDIUM'); // Correctly elevated to caution due to single source
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
      currentPriceEur: 15.00,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [45.00, 50.00]
    });

    expect(res.riskFlags).toContain('SOURCE_DISAGREEMENT');
    expect(res.riskLevel).toBe('MEDIUM');
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
});
