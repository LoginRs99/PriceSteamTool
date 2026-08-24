import { describe, it, expect } from 'vitest';
import { 
  generateActionSignal, 
  analyzeDiscountCycle, 
  getUpcomingSteamSale 
} from '../../src/server/domain/actionSignal.js';
import type { PriceHistoryEntry } from '../../src/shared/types.js';

describe('Action Signal & Discount Cycle Engine', () => {

  describe('analyzeDiscountCycle', () => {
    it('should return Unknown frequency when insufficient history points', () => {
      const result = analyzeDiscountCycle([], 59.99, 29.99);
      expect(result.saleFrequencyCategory).toBe('Unknown');
      expect(result.avgDaysBetweenSales).toBeUndefined();
    });

    it('should detect regular discount intervals from price history', () => {
      const now = new Date('2026-08-15T00:00:00Z');
      const history: PriceHistoryEntry[] = [
        // Event 1: April 1 (discounted)
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 14.99, recordedAt: '2026-04-01T00:00:00Z' },
        { id: '2', gameId: 'g1', sourceCode: 'steam', priceEur: 49.99, recordedAt: '2026-04-10T00:00:00Z' },
        // Event 2: May 1 (~30 days later)
        { id: '3', gameId: 'g1', sourceCode: 'steam', priceEur: 14.99, recordedAt: '2026-05-01T00:00:00Z' },
        { id: '4', gameId: 'g1', sourceCode: 'steam', priceEur: 49.99, recordedAt: '2026-05-10T00:00:00Z' },
        // Event 3: June 1 (~31 days later)
        { id: '5', gameId: 'g1', sourceCode: 'steam', priceEur: 14.99, recordedAt: '2026-06-01T00:00:00Z' },
        { id: '6', gameId: 'g1', sourceCode: 'steam', priceEur: 49.99, recordedAt: '2026-06-10T00:00:00Z' }
      ];

      const cycle = analyzeDiscountCycle(history, 49.99, 14.99, now);
      expect(cycle.saleFrequencyCategory).toBe('Frequent');
      expect(cycle.avgDaysBetweenSales).toBeGreaterThanOrEqual(28);
      expect(cycle.avgDaysBetweenSales).toBeLessThanOrEqual(35);
      expect(cycle.isSaleOverdue).toBe(true); // Last discount ended in June, now is August (> 60 days)
    });
  });

  describe('generateActionSignal', () => {
    it('should assign STRONG_BUY for high score and high confidence near ATL', () => {
      const signal = generateActionSignal({
        dealScore: 92,
        confidenceScore: 85,
        isProvisional: false,
        isAnomaly: false,
        currentPriceEur: 9.99,
        basePriceEur: 59.99,
        typicalSaleMedianEur: 24.99,
        typicalSaleQ1Eur: 14.99,
        historicalLowEur: 9.99,
        typicalSaleSampleCount: 15
      });

      expect(signal.decision).toBe('STRONG_BUY');
      expect(signal.badgeLabel).toBe('Strong Buy');
      expect(signal.urgency).toBe('HIGH');
      expect(signal.badgeColor).toBe('#10b981');
      expect(signal.expectedSaleTargetEur).toBe(24.99);
      expect(signal.primaryReason).toContain('Exceptional buying opportunity');
      expect(signal.timingContext).toContain('immediate purchase strongly recommended');
    });

    it('should assign BUY for solid score and medium confidence', () => {
      const signal = generateActionSignal({
        dealScore: 78,
        confidenceScore: 60,
        isProvisional: false,
        isAnomaly: false,
        currentPriceEur: 17.99,
        basePriceEur: 59.99,
        typicalSaleMedianEur: 29.99,
        typicalSaleQ1Eur: 19.99,
        historicalLowEur: 14.99,
        typicalSaleSampleCount: 8
      });

      expect(signal.decision).toBe('BUY');
      expect(signal.badgeLabel).toBe('Buy');
      expect(signal.urgency).toBe('MEDIUM');
      expect(signal.badgeColor).toBe('#06b6d4');
    });

    it('should assign WAIT when a major Steam Sale is imminent (<= 14 days) and score is not exceptional', () => {
      // 5 days before Steam Summer Sale (June 25)
      const fakeNow = new Date(2026, 5, 20); // June 20

      const signal = generateActionSignal({
        dealScore: 60,
        confidenceScore: 70,
        isProvisional: false,
        isAnomaly: false,
        currentPriceEur: 39.99,
        basePriceEur: 59.99,
        typicalSaleMedianEur: 29.99,
        typicalSaleQ1Eur: 19.99,
        historicalLowEur: 14.99,
        typicalSaleSampleCount: 10,
        currentDate: fakeNow
      });

      expect(signal.decision).toBe('WAIT');
      expect(signal.badgeLabel).toBe('Wait (Steam Sale)');
      expect(signal.upcomingEventName).toBe('Steam Summer Sale');
      expect(signal.daysUntilUpcomingEvent).toBeLessThanOrEqual(14);
    });

    it('should assign WAIT when game is frequently discounted and currently at or near typical/full price', () => {
      const fakeNow = new Date('2026-08-15T00:00:00Z');
      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: 'g1', sourceCode: 'steam', priceEur: 9.99, recordedAt: '2026-06-01T00:00:00Z' },
        { id: '2', gameId: 'g1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2026-06-10T00:00:00Z' },
        { id: '3', gameId: 'g1', sourceCode: 'steam', priceEur: 9.99, recordedAt: '2026-07-01T00:00:00Z' },
        { id: '4', gameId: 'g1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2026-07-10T00:00:00Z' }
      ];

      const signal = generateActionSignal({
        dealScore: 40,
        confidenceScore: 75,
        isProvisional: false,
        isAnomaly: false,
        currentPriceEur: 29.99,
        basePriceEur: 29.99,
        typicalSaleMedianEur: 9.99,
        typicalSaleQ1Eur: 9.99,
        historicalLowEur: 9.99,
        typicalSaleSampleCount: 12,
        history,
        currentDate: fakeNow
      });

      expect(signal.decision).toBe('WAIT');
      expect(signal.badgeLabel).toBe('Wait for Sale');
    });

    it('should assign PROVISIONAL when data is sparse or flagged as anomaly', () => {
      const signalAnomaly = generateActionSignal({
        dealScore: 99,
        confidenceScore: 20,
        isProvisional: true,
        isAnomaly: true,
        currentPriceEur: 0.50,
        basePriceEur: 69.99
      });
      expect(signalAnomaly.decision).toBe('PROVISIONAL');
      expect(signalAnomaly.badgeLabel).toBe('Flagged Anomaly');

      const signalSparse = generateActionSignal({
        dealScore: 65,
        confidenceScore: 15,
        isProvisional: true,
        isAnomaly: false,
        currentPriceEur: 19.99,
        basePriceEur: 59.99,
        typicalSaleSampleCount: 1
      });
      expect(signalSparse.decision).toBe('PROVISIONAL');
      expect(signalSparse.badgeLabel).toBe('Provisional Data');
    });
  });
});
