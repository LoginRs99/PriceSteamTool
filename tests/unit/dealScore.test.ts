import { describe, it, expect } from 'vitest';
import { 
  calculateDealScore, 
  calculateDiscountScore, 
  calculateHistoricalScore, 
  calculateTrustScore,
  getDealScoreTier 
} from '../../src/server/domain/dealScore.js';

describe('Deterministic Deal Score Calculator (0–100)', () => {
  // ----------------------------------------------------
  // 1. Discount Pillar Boundaries
  // ----------------------------------------------------
  describe('Pillar 1: Discount Score Boundaries', () => {
    it('evaluates 0% and negative discounts to 0 points', () => {
      expect(calculateDiscountScore(0)).toBe(0);
      expect(calculateDiscountScore(-15)).toBe(0);
    });

    it('evaluates 20% discount boundary (12.0 pts)', () => {
      expect(calculateDiscountScore(10)).toBe(6.0);
      expect(calculateDiscountScore(20)).toBe(12.0);
    });

    it('evaluates 50% discount boundary (33.0 pts)', () => {
      expect(calculateDiscountScore(35)).toBe(22.5);
      expect(calculateDiscountScore(50)).toBe(33.0);
    });

    it('evaluates 85% discount boundary (44.9 pts)', () => {
      expect(calculateDiscountScore(75)).toBe(41.5);
      expect(calculateDiscountScore(85)).toBe(44.9);
    });

    it('evaluates >85% discounts capped at 45.0 points', () => {
      expect(calculateDiscountScore(90)).toBe(45.0);
      expect(calculateDiscountScore(99)).toBe(45.0);
    });
  });

  // ----------------------------------------------------
  // 2. Historical Context Pillar Boundaries
  // ----------------------------------------------------
  describe('Pillar 2: Historical Score Boundaries', () => {
    it('awards 35 points for NEW_HISTORICAL_LOW', () => {
      expect(calculateHistoricalScore('NEW_HISTORICAL_LOW')).toBe(35);
    });

    it('awards 28 points for AT_HISTORICAL_LOW', () => {
      expect(calculateHistoricalScore('AT_HISTORICAL_LOW')).toBe(28);
    });

    it('awards 20 points for NEAR_HISTORICAL_LOW', () => {
      expect(calculateHistoricalScore('NEAR_HISTORICAL_LOW')).toBe(20);
    });

    it('awards 15 points for MAJOR_DROP and EXTREME_DROP', () => {
      expect(calculateHistoricalScore('MAJOR_DROP')).toBe(15);
      expect(calculateHistoricalScore('EXTREME_DROP')).toBe(15);
    });

    it('awards 8 points for MINOR_DROP', () => {
      expect(calculateHistoricalScore('MINOR_DROP')).toBe(8);
    });

    it('awards 0 points for NONE or undefined', () => {
      expect(calculateHistoricalScore('NONE')).toBe(0);
      expect(calculateHistoricalScore(undefined)).toBe(0);
    });
  });

  // ----------------------------------------------------
  // 3. Trust & Consensus Pillar Boundaries
  // ----------------------------------------------------
  describe('Pillar 3: Trust & Consensus Score Boundaries', () => {
    it('awards 20 points for official store with 3+ sources', () => {
      expect(calculateTrustScore(true, 1.0, 3)).toBe(20.0);
      expect(calculateTrustScore(true, 1.0, 4)).toBe(20.0);
    });

    it('awards 17 points for official store with 2 sources', () => {
      expect(calculateTrustScore(true, 1.0, 2)).toBe(17.0);
    });

    it('awards 14 points for official store with 1 source', () => {
      expect(calculateTrustScore(true, 1.0, 1)).toBe(14.0);
    });

    it('awards 13 points for high-trust keyshop (>=0.8) with 2 sources', () => {
      expect(calculateTrustScore(false, 0.85, 2)).toBe(13.0);
    });

    it('awards 6 points for low-trust keyshop (<0.8) with 1 source', () => {
      expect(calculateTrustScore(false, 0.5, 1)).toBe(6.0);
    });
  });

  // ----------------------------------------------------
  // 4. Confidence Multiplier & Risk Boundaries
  // ----------------------------------------------------
  describe('Pillar 4: Confidence & Risk Boundaries', () => {
    it('applies confidence multiplier correctly', () => {
      // 50% discount (33) + MAJOR_DROP (15) + Official 1 source (14) = 62 subtotal
      const base = {
        priceEur: 15.00,
        basePriceEur: 30.00,
        discountPercent: 50,
        priceEvent: 'MAJOR_DROP' as const,
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        riskLevel: 'SAFE' as const
      };

      // Conf = 1.0 -> 62 * 1.00 - 0 = 62
      expect(calculateDealScore({ ...base, evaluationConfidence: 1.0 }).score).toBe(62);

      // Conf = 0.5 -> 62 * 0.85 - 0 = 52.7 -> 53
      expect(calculateDealScore({ ...base, evaluationConfidence: 0.5 }).score).toBe(53);

      // Conf = 0.0 -> 62 * 0.70 - 0 = 43.4 -> 43
      expect(calculateDealScore({ ...base, evaluationConfidence: 0.0 }).score).toBe(43);
    });

    it('deducts 5 points for LOW risk', () => {
      const res = calculateDealScore({
        priceEur: 15.00,
        basePriceEur: 30.00,
        discountPercent: 50,
        priceEvent: 'MAJOR_DROP',
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        evaluationConfidence: 1.0,
        riskLevel: 'LOW'
      });
      // 62 * 1.0 - 5 = 57
      expect(res.score).toBe(57);
    });

    it('deducts 25 points for MEDIUM risk (exact 33 boundary test)', () => {
      // 60% discount (36.4) + MAJOR_DROP (15) + Keyshop trust 0.85 (6) + 1 source (4) = 61.4 subtotal
      // Multiplier at Conf 0.80 = 0.70 + 0.30 * 0.8 = 0.94
      // 61.4 * 0.94 - 25 = 57.716 - 25 = 32.716 -> round = 33
      const res = calculateDealScore({
        priceEur: 24.00,
        basePriceEur: 60.00,
        discountPercent: 60,
        priceEvent: 'MAJOR_DROP',
        isOfficialMerchant: false,
        merchantTrustScore: 0.85,
        sourceAgreementCount: 1,
        evaluationConfidence: 0.80,
        riskLevel: 'MEDIUM'
      });
      expect(res.score).toBe(33);
      expect(res.tier).toBe('Weak');
    });

    it('applies 60-point penalty and enforces 35 max safety cap for HIGH risk', () => {
      // 90% discount (45) + NEW_HISTORICAL_LOW (35) + Official 3 sources (20) = 100 subtotal
      // Raw: 100 * 1.0 - 60 = 40 -> capped at 35!
      const highRiskWithExtremeDiscount = calculateDealScore({
        priceEur: 6.00,
        basePriceEur: 60.00,
        discountPercent: 90,
        priceEvent: 'NEW_HISTORICAL_LOW',
        isOfficialMerchant: true,
        sourceAgreementCount: 3,
        evaluationConfidence: 1.0,
        riskLevel: 'HIGH'
      });
      expect(highRiskWithExtremeDiscount.score).toBe(35);
      expect(highRiskWithExtremeDiscount.tier).toBe('Weak');

      // Marked anomaly also capped at 35
      const anomalyOffer = calculateDealScore({
        priceEur: 6.00,
        basePriceEur: 60.00,
        discountPercent: 90,
        priceEvent: 'NEW_HISTORICAL_LOW',
        isOfficialMerchant: true,
        sourceAgreementCount: 3,
        evaluationConfidence: 1.0,
        riskLevel: 'SAFE',
        isAnomaly: true
      });
      expect(anomalyOffer.score).toBe(35);
    });
  });

  // ----------------------------------------------------
  // 5. Complete End-to-End Concrete Example Validations
  // ----------------------------------------------------
  describe('Concrete User Example Scenarios', () => {
    it('Example 1: Legitimate New All-Time Low (Cyberpunk 2077 on Steam Store) -> 97 Exceptional', () => {
      const res = calculateDealScore({
        priceEur: 14.99,
        basePriceEur: 59.99,
        discountPercent: 75,
        priceEvent: 'NEW_HISTORICAL_LOW',
        isOfficialMerchant: true,
        sourceAgreementCount: 3,
        riskLevel: 'SAFE',
        evaluationConfidence: 1.0
      });
      expect(res.score).toBe(97);
      expect(res.tier).toBe('Exceptional');
    });

    it('Example 2: Normal 20% Publisher Sale on Steam Store -> 36 Weak', () => {
      const res = calculateDealScore({
        priceEur: 47.99,
        basePriceEur: 59.99,
        discountPercent: 20,
        priceEvent: 'MINOR_DROP',
        isOfficialMerchant: true,
        sourceAgreementCount: 2,
        riskLevel: 'SAFE',
        evaluationConfidence: 0.90
      });
      expect(res.score).toBe(36);
      expect(res.tier).toBe('Weak');
    });

    it('Example 3: Major 60% Deal on Authorized Retailer Fanatical -> 72 Great', () => {
      const res = calculateDealScore({
        priceEur: 23.99,
        basePriceEur: 59.99,
        discountPercent: 60,
        priceEvent: 'NEAR_HISTORICAL_LOW',
        isOfficialMerchant: true,
        sourceAgreementCount: 2,
        riskLevel: 'SAFE',
        evaluationConfidence: 0.95
      });
      expect(res.score).toBe(72);
      expect(res.tier).toBe('Great');
    });

    it('Example 4: 98% Pricing Typo / Glitch on Unknown Keyshop -> 16 Weak', () => {
      const res = calculateDealScore({
        priceEur: 0.99,
        basePriceEur: 59.99,
        discountPercent: 98,
        priceEvent: 'NEW_HISTORICAL_LOW',
        isOfficialMerchant: false,
        merchantTrustScore: 0.5,
        sourceAgreementCount: 1,
        riskLevel: 'HIGH',
        evaluationConfidence: 0.60,
        isAnomaly: true
      });
      expect(res.score).toBe(16);
      expect(res.tier).toBe('Weak');
    });

    it('Example 5: Full Price Game (0% discount, standard price) -> 14 Weak', () => {
      const res = calculateDealScore({
        priceEur: 59.99,
        basePriceEur: 59.99,
        discountPercent: 0,
        priceEvent: 'NONE',
        isOfficialMerchant: true,
        sourceAgreementCount: 1,
        riskLevel: 'SAFE',
        evaluationConfidence: 1.0
      });
      expect(res.score).toBe(14);
      expect(res.tier).toBe('Weak');
    });
  });
});
