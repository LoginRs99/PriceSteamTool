import { describe, it, expect } from 'vitest';
import { calculateSteamDbRating, parseReviewTotal } from '../../src/server/domain/rating.js';

describe('Rating Domain Logic', () => {
  describe('parseReviewTotal', () => {
    it('parses formatted numeric strings correctly', () => {
      expect(parseReviewTotal('12,345')).toBe(12345);
      expect(parseReviewTotal('1 200')).toBe(1200);
      expect(parseReviewTotal('999')).toBe(999);
      expect(parseReviewTotal('1,000,500')).toBe(1000500);
    });

    it('handles numeric numbers directly', () => {
      expect(parseReviewTotal(500)).toBe(500);
      expect(parseReviewTotal(0)).toBe(0);
      expect(parseReviewTotal(123.45)).toBe(123);
    });

    it('returns undefined for invalid or missing inputs', () => {
      expect(parseReviewTotal(undefined)).toBeUndefined();
      expect(parseReviewTotal(null)).toBeUndefined();
      expect(parseReviewTotal('')).toBeUndefined();
      expect(parseReviewTotal('none')).toBeUndefined();
      expect(parseReviewTotal(-10)).toBeUndefined();
      expect(parseReviewTotal(NaN)).toBeUndefined();
      expect(parseReviewTotal(Infinity)).toBeUndefined();
    });
  });

  describe('calculateSteamDbRating', () => {
    it('returns undefined when reviews count or percent is missing or invalid', () => {
      expect(calculateSteamDbRating(undefined, 100)).toBeUndefined();
      expect(calculateSteamDbRating(90, undefined)).toBeUndefined();
      expect(calculateSteamDbRating(null, '500')).toBeUndefined();
      expect(calculateSteamDbRating(90, null)).toBeUndefined();
      expect(calculateSteamDbRating(NaN, 100)).toBeUndefined();
      expect(calculateSteamDbRating(90, 0)).toBeUndefined();
      expect(calculateSteamDbRating(-5, 100)).toBeUndefined();
      expect(calculateSteamDbRating(105, 100)).toBeUndefined();
    });

    it('mitigates sample size bias for very small review counts', () => {
      // 1 review that is 100% positive should NOT yield 100% rating
      // Formula: 1.0 - (1.0 - 0.5) * 2^(-log10(2)) = 1 - 0.5 * 0.81225 = 0.5939 -> 59.4%
      const singleReviewScore = calculateSteamDbRating(100, 1);
      expect(singleReviewScore).toBeDefined();
      expect(singleReviewScore).toBeGreaterThanOrEqual(58);
      expect(singleReviewScore).toBeLessThanOrEqual(61);

      // 10 reviews with 100% positive
      // Formula: 1.0 - 0.5 * 2^(-log10(11)) = 1 - 0.5 * 0.4859 = 0.757 -> 75.7%
      const tenReviewScore = calculateSteamDbRating(100, 10);
      expect(tenReviewScore).toBeDefined();
      expect(tenReviewScore).toBeGreaterThan(singleReviewScore!);
      expect(tenReviewScore).toBeLessThan(80);
    });

    it('converges close to the true percentage for high review volumes (popular AAA / indie hits)', () => {
      // 95% positive with 50,000 reviews
      const rating = calculateSteamDbRating(95, 50000);
      expect(rating).toBeDefined();
      // Should be very close to 95% (e.g., around 93-94%)
      expect(rating).toBeGreaterThan(93);
      expect(rating).toBeLessThanOrEqual(95);

      // 98% positive with 100,000 reviews
      const massiveRating = calculateSteamDbRating(98, 100000);
      expect(massiveRating).toBeDefined();
      expect(massiveRating).toBeGreaterThanOrEqual(96.5);
      expect(massiveRating).toBeLessThanOrEqual(98);
    });

    it('handles string total review values with commas and spaces', () => {
      const formattedRating = calculateSteamDbRating(88, '12,540');
      const numericRating = calculateSteamDbRating(88, 12540);
      expect(formattedRating).toBe(numericRating);
    });

    it('pulls negative reviews towards neutral 50% when review count is low', () => {
      // 0% positive with 1 review
      const singleNegative = calculateSteamDbRating(0, 1);
      expect(singleNegative).toBeDefined();
      // Should be pulled up towards 50% (around 40.6%)
      expect(singleNegative).toBeGreaterThan(39);
      expect(singleNegative).toBeLessThan(42);

      // 0% positive with 10,000 reviews
      const massiveNegative = calculateSteamDbRating(0, 10000);
      expect(massiveNegative).toBeDefined();
      // Should be close to 0%
      expect(massiveNegative).toBeLessThan(5);
    });


    it('returns exact 50.0% when raw score is 50%', () => {
      expect(calculateSteamDbRating(50, 1)).toBe(50);
      expect(calculateSteamDbRating(50, 100)).toBe(50);
      expect(calculateSteamDbRating(50, 10000)).toBe(50);
    });
  });
});
