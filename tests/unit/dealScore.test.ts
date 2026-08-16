import { describe, it, expect } from 'vitest';
import { 
  calculateDealScore, 
  calculateBaseScore,
  calculateRarityBonus,
  getDealScoreTier,
  LOGISTIC_STEEPNESS,
  BASE_SCORE_CEILING,
  PRICE_MATCH_EPSILON_EUR,
  ATL_BONUS,
  LOW90D_BONUS,
  LOW1Y_BONUS,
  ATL_PROXIMITY_TAIL_MAX,
  NO_HISTORY_FALLBACK_CAP
} from '../../src/server/domain/dealScore.js';

describe('Deal Score v2 Calculator', () => {
  // ----------------------------------------------------
  // 1. Stage 1: Base Score (Median & Volatility Normalization)
  // ----------------------------------------------------
  describe('Stage 1: Base Score', () => {
    it('evaluates exact median price to dead center ~35 base score', () => {
      // When price matches typical sale median, z = 0 -> 70 / (1 + exp(0)) = 35
      const res = calculateBaseScore(25.00, 25.00, 20.00, 30.00);
      expect(res.zScore).toBe(0);
      expect(Math.round(res.baseScore)).toBe(35);
      expect(res.isLowSample).toBe(false);
    });

    it('evaluates full-IQR case with realistic price volatility', () => {
      // Median 25, Q1 20, Q3 30 -> IQR = 10, scale = 10 / 1.349 ≈ 7.413
      // Price 15 -> z = (25 - 15) / 7.413 = 1.349 -> baseScore = 70 / (1 + exp(-1.1 * 1.349)) ≈ 57.06
      const res = calculateBaseScore(15.00, 25.00, 20.00, 30.00);
      expect(res.zScore).toBeGreaterThan(1.3);
      expect(res.baseScore).toBeGreaterThan(55);
      expect(res.baseScore).toBeLessThan(65);
    });

    it('evaluates median-only case (no Q1/Q3) using the 3% scale floor', () => {
      // Median 25, no Q1/Q3 -> scale = 25 * 0.03 = 0.75
      // Price 24 -> z = (25 - 24) / 0.75 = 1.333
      const res = calculateBaseScore(24.00, 25.00, undefined, undefined);
      expect(res.zScore).toBeCloseTo(1.333, 2);
      expect(res.baseScore).toBeGreaterThan(55);
    });

    it('falls back to capped MSRP discount when median is null (no history)', () => {
      // Base price €60, Price €30 (50% discount) -> min(25, 50 * 0.3) = 15
      const res = calculateBaseScore(30.00, null, undefined, undefined, 60.00);
      expect(res.baseScore).toBe(15);
      expect(res.isLowSample).toBe(true);
      expect(res.zScore).toBeUndefined();

      // Base price €60, Price €6 (90% discount) -> min(25, 90 * 0.3) = capped at 25
      const resDeep = calculateBaseScore(6.00, null, undefined, undefined, 60.00);
      expect(resDeep.baseScore).toBe(NO_HISTORY_FALLBACK_CAP);
      expect(resDeep.isLowSample).toBe(true);
    });

    it('returns 0 base score when price is above MSRP and no history exists', () => {
      const res = calculateBaseScore(70.00, null, undefined, undefined, 60.00);
      expect(res.baseScore).toBe(0);
      expect(res.isLowSample).toBe(true);
    });
  });

  // ----------------------------------------------------
  // 2. Stage 2: Single-Ladder Rarity Bonus
  // ----------------------------------------------------
  describe('Stage 2: Single-Ladder Rarity Bonus', () => {
    const atl = 19.00;
    const low90d = 22.00;
    const low1y = 24.00;

    it('awards 30 points for matching or undercutting confirmed ATL', () => {
      expect(calculateRarityBonus(18.00, atl, low90d, low1y)).toBe(ATL_BONUS);
      expect(calculateRarityBonus(19.00, atl, low90d, low1y)).toBe(ATL_BONUS);
    });

    it('awards ATL bonus within the +0.05 EUR epsilon tolerance', () => {
      // 19.00 + 0.05 = 19.05 qualifies for ATL
      expect(calculateRarityBonus(19.05, atl, low90d, low1y)).toBe(ATL_BONUS);
      // 19.06 exceeds ATL tolerance -> falls to next tier
      expect(calculateRarityBonus(19.06, atl, low90d, low1y)).toBe(LOW90D_BONUS);
    });

    it('awards 18 points for matching 90-day low (when ATL is not reached)', () => {
      expect(calculateRarityBonus(22.00, atl, low90d, low1y)).toBe(LOW90D_BONUS);
      expect(calculateRarityBonus(22.05, atl, low90d, low1y)).toBe(LOW90D_BONUS);
    });

    it('awards 10 points for matching 1-year low (when 90d low is not reached)', () => {
      expect(calculateRarityBonus(23.50, atl, low90d, low1y)).toBe(LOW1Y_BONUS);
      expect(calculateRarityBonus(24.05, atl, low90d, low1y)).toBe(LOW1Y_BONUS);
    });

    it('awards continuous proximity tail when price is above 1y low but close to ATL', () => {
      // ATL = 19, Price = 25 -> proximity = 1 - (25 - 19) / (19 * 0.5) = 1 - 6 / 9.5 ≈ 0.368
      // tail = round(8 * 0.368) = 3
      const bonus = calculateRarityBonus(25.00, atl, null, null);
      expect(bonus).toBe(3);
    });

    it('returns 0 rarity bonus when far above ATL', () => {
      // Price = 40, ATL = 19 -> (40 - 19) / 9.5 > 1 -> proximity = 0
      expect(calculateRarityBonus(40.00, atl, null, null)).toBe(0);
    });
  });

  // ----------------------------------------------------
  // 3. Safety Guard (§6)
  // ----------------------------------------------------
  describe('Safety Guard: HIGH risk & Anomaly Cap (35)', () => {
    it('caps an exceptional score to 35 if riskLevel is HIGH', () => {
      const res = calculateDealScore({
        priceEur: 19.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 25.00,
        typicalSaleQ1Eur: 22.47,
        typicalSaleQ3Eur: 27.53,
        allTimeLowEur: 19.00,
        riskLevel: 'HIGH'
      });
      expect(res.score).toBe(35);
      expect(res.tier).toBe('Weak');
    });

    it('caps an exceptional score to 35 if isAnomaly is true', () => {
      const res = calculateDealScore({
        priceEur: 19.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 25.00,
        typicalSaleQ1Eur: 22.47,
        typicalSaleQ3Eur: 27.53,
        allTimeLowEur: 19.00,
        riskLevel: 'SAFE',
        isAnomaly: true
      });
      expect(res.score).toBe(35);
      expect(res.tier).toBe('Weak');
    });

    it('does not affect a safe, non-anomalous offer', () => {
      const res = calculateDealScore({
        priceEur: 19.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 25.00,
        typicalSaleQ1Eur: 22.47,
        typicalSaleQ3Eur: 27.53,
        allTimeLowEur: 19.00,
        riskLevel: 'SAFE',
        isAnomaly: false
      });
      expect(res.score).toBeGreaterThanOrEqual(85);
      expect(res.tier).toBe('Exceptional');
    });
  });

  // ----------------------------------------------------
  // 4. Worked-Example Validations from Specification §7
  // ----------------------------------------------------
  describe('Worked Examples from Specification §7', () => {
    // Game: MSRP €60, Median €25, 90d Low €22, ATL €19.
    // scale ≈ €3.75 (e.g. Q1 ≈ 22.47, Q3 ≈ 27.53 -> IQR ≈ 5.06 -> scale = 5.06 / 1.349 ≈ 3.75)
    const baseGame = {
      basePriceEur: 60.00,
      typicalSaleMedianEur: 25.00,
      typicalSaleQ1Eur: 22.47,
      typicalSaleQ3Eur: 27.53,
      low90dEur: 22.00,
      low1yEur: 24.00,
      allTimeLowEur: 19.00,
      riskLevel: 'SAFE' as const,
      isAnomaly: false
    };

    it('Case 1: €30 (above typical sale median €25) -> Weak deal (~13)', () => {
      const res = calculateDealScore({
        ...baseGame,
        priceEur: 30.00
      });
      expect(res.score).toBeGreaterThanOrEqual(10);
      expect(res.score).toBeLessThanOrEqual(16);
      expect(res.tier).toBe('Weak');
    });

    it('Case 2: €22 (matches 90-day low, well below median) -> Great / Fair border (~67-68)', () => {
      const res = calculateDealScore({
        ...baseGame,
        priceEur: 22.00
      });
      expect(res.score).toBeGreaterThanOrEqual(65);
      expect(res.score).toBeLessThanOrEqual(72);
    });

    it('Case 3: €19 (matches All-Time Low) -> Exceptional deal (~90)', () => {
      const res = calculateDealScore({
        ...baseGame,
        priceEur: 19.00
      });
      expect(res.score).toBeGreaterThanOrEqual(85);
      expect(res.score).toBeLessThanOrEqual(95);
      expect(res.tier).toBe('Exceptional');
    });
  });

  // ----------------------------------------------------
  // 5. Tier Classifications
  // ----------------------------------------------------
  describe('Deal Score Tiers', () => {
    it('maps scores to intuitive qualitative tiers', () => {
      expect(getDealScoreTier(100)).toBe('Exceptional');
      expect(getDealScoreTier(85)).toBe('Exceptional');
      expect(getDealScoreTier(84)).toBe('Great');
      expect(getDealScoreTier(70)).toBe('Great');
      expect(getDealScoreTier(69)).toBe('Fair');
      expect(getDealScoreTier(40)).toBe('Fair');
      expect(getDealScoreTier(39)).toBe('Weak');
      expect(getDealScoreTier(0)).toBe('Weak');
    });
  });
});
