import { describe, it, expect } from 'vitest';
import { 
  calculatePeriodLows, 
  calculateTypicalSalePrice, 
  groupSaleEvents, 
  calculatePriceVolatility, 
  calculateMarketComparison, 
  evaluatePurchaseAdvice, 
  generatePriceIntelligence 
} from '../../src/server/domain/priceIntelligence.js';
import type { Game, Offer, PriceHistoryEntry } from '../../src/shared/types.js';

describe('Price Intelligence Domain Engine — v1.3', () => {
  const baseGame: Game = {
    id: 'game-1',
    steamAppId: 1091500,
    title: 'Cyberpunk 2077',
    slug: 'cyberpunk-2077',
    basePriceEur: 59.99,
    historicalLowEur: 29.99,
    historicalLowDate: '2025-11-25T12:00:00Z',
    historicalLowSource: 'Steam',
    isDlc: false,
    isFree: false,
    hasAnomaly: false,
    offersCount: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z'
  };

  const sampleOffer: Offer = {
    id: 'off-1',
    gameId: 'game-1',
    merchantId: 'm-steam',
    merchantName: 'Steam',
    merchantCode: 'steam',
    isOfficial: true,
    productType: 'DIRECT_PURCHASE',
    regionType: 'GLOBAL',
    regionConfidence: 1.0,
    priceEur: 29.99,
    originalPriceEur: 59.99,
    discountPercent: 50,
    dealUrl: 'https://store.steampowered.com/app/1091500',
    isValid: true,
    isBestDeal: true,
    priceEvent: 'NEW_HISTORICAL_LOW',
    riskLevel: 'SAFE',
    riskScore: 0,
    riskFlags: [],
    evaluationConfidence: 1.0,
    isAnomaly: false,
    sources: ['steam'],
    sourceAgreementCount: 3,
    dealScore: 92,
    dealTier: 'Exceptional',
    fetchedAt: '2026-08-15T12:00:00Z',
    lastObservedAt: '2026-08-15T12:00:00Z',
    createdAt: '2026-08-15T12:00:00Z',
    updatedAt: '2026-08-15T12:00:00Z'
  };

  describe('1. Rolling Period Lows', () => {
    it('returns actual observed low for 7d and null for longer periods if game history is only 3 days old', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

      const shortHistory: PriceHistoryEntry[] = [
        {
          id: 'ph-1',
          gameId: 'game-1',
          sourceCode: 'steam',
          priceEur: 34.99,
          recordedAt: threeDaysAgo
        },
        {
          id: 'ph-2',
          gameId: 'game-1',
          sourceCode: 'steam',
          priceEur: 29.99,
          recordedAt: twoDaysAgo
        }
      ];

      const periodLows = calculatePeriodLows(baseGame, shortHistory, sampleOffer);

      expect(periodLows.low7d.priceEur).toBe(29.99);
      expect(periodLows.low7d.isExactPeriodData).toBe(true);

      // 30d, 90d, 1y must be null since history span is only 3 days
      expect(periodLows.low30d.priceEur).toBeNull();
      expect(periodLows.low30d.isExactPeriodData).toBe(false);
      expect(periodLows.low90d.priceEur).toBeNull();
      expect(periodLows.low1y.priceEur).toBeNull();
    });

    it('returns exact period lows when sufficient historical span exists', () => {
      const now = new Date();
      const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

      const longHistory: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 19.99, recordedAt: daysAgo(300) },
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 24.99, recordedAt: daysAgo(80) },
        { id: 'ph-3', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(20) },
        { id: 'ph-4', gameId: 'game-1', sourceCode: 'steam', priceEur: 39.99, recordedAt: daysAgo(5) }
      ];

      const periodLows = calculatePeriodLows(baseGame, longHistory, sampleOffer);

      expect(periodLows.low7d.priceEur).toBe(29.99); // sampleOffer is 29.99 (within 7d)
      expect(periodLows.low30d.priceEur).toBe(29.99);
      expect(periodLows.low90d.priceEur).toBe(24.99);
      expect(periodLows.low1y.priceEur).toBe(19.99);
    });
  });

  describe('2. Typical Sale Price with IQR Outlier Filtering', () => {
    it('returns null median when no sale observations exist', () => {
      const msrpHistory: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 59.99, recordedAt: '2026-01-01T00:00:00Z' }
      ];
      const res = calculateTypicalSalePrice(59.99, msrpHistory);
      expect(res.medianPriceEur).toBeNull();
      expect(res.sampleCount).toBe(0);
      expect(res.isLowConfidence).toBe(true);
    });

    it('computes clean median and filters out an extreme glitch outlier via IQR', () => {
      // Normal sales at 29.99, 29.99, 29.99, 34.99, plus one glitch at 0.49
      const historyWithGlitch: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 0.49, recordedAt: '2025-02-01T00:00:00Z' },
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2025-04-01T00:00:00Z' },
        { id: 'ph-3', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2025-06-01T00:00:00Z' },
        { id: 'ph-4', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2025-08-01T00:00:00Z' },
        { id: 'ph-5', gameId: 'game-1', sourceCode: 'steam', priceEur: 34.99, recordedAt: '2025-10-01T00:00:00Z' },
        { id: 'ph-6', gameId: 'game-1', sourceCode: 'steam', priceEur: 34.99, recordedAt: '2025-12-01T00:00:00Z' }
      ];

      const res = calculateTypicalSalePrice(59.99, historyWithGlitch);
      expect(res.medianPriceEur).toBe(29.99);
      expect(res.isLowConfidence).toBe(false);
      // The 0.49 glitch was filtered out by Tukey's fences!
      expect(res.sampleCount).toBe(5);
    });
  });

  describe('3. Sale Event Grouping (3 Mandatory Test Cases)', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

    it('Case 1: continuous sale with missing sync within 14 days -> single sale event', () => {
      const history: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(50) },
        // Sync gap of 10 days, but no normal price recorded
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(40) }
      ];

      const res = groupSaleEvents(59.99, history);
      expect(res.saleEventsLast12m).toBe(1);
    });

    it('Case 2: normal price observation in between -> closes first event and starts new event', () => {
      const history: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(50) },
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 59.99, recordedAt: daysAgo(45) }, // returned to MSRP
        { id: 'ph-3', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(40) }  // new sale
      ];

      const res = groupSaleEvents(59.99, history);
      expect(res.saleEventsLast12m).toBe(2);
    });

    it('Case 3: two distinct sales separated by > 14 days gap -> two distinct events', () => {
      const history: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(100) },
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: daysAgo(40) } // 60 days gap
      ];

      const res = groupSaleEvents(59.99, history);
      expect(res.saleEventsLast12m).toBe(2);
    });
  });

  describe('4. Price Volatility & Missing Days Handling', () => {
    it('calculates volatility strictly on observed days without synthetic jumps on missing days', () => {
      const history: PriceHistoryEntry[] = [
        { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 59.99, recordedAt: '2026-08-01T10:00:00Z' },
        { id: 'ph-2', gameId: 'game-1', sourceCode: 'steam', priceEur: 59.99, recordedAt: '2026-08-02T10:00:00Z' },
        // Aug 03 is missing, Aug 04 has sale:
        { id: 'ph-3', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2026-08-04T10:00:00Z' }
      ];

      const res = calculatePriceVolatility(history);
      expect(res.priceChangesCount).toBe(1); // Exactly 1 change from Aug 02 (59.99) -> Aug 04 (29.99)
      expect(res.category).toBeDefined();
    });
  });

  describe('5. Market Comparison Scope', () => {
    it('excludes restricted regions and high risk anomalies from market median', () => {
      const offers: Offer[] = [
        sampleOffer,
        {
          ...sampleOffer,
          id: 'off-2',
          merchantName: 'Fanatical',
          priceEur: 32.99
        },
        {
          ...sampleOffer,
          id: 'off-3',
          merchantName: 'G2A RU Key',
          priceEur: 4.99,
          regionType: 'RESTRICTED', // Incompatible
          riskLevel: 'HIGH'
        }
      ];

      const res = calculateMarketComparison(offers, sampleOffer);
      expect(res.totalCompatibleOffers).toBe(2);
      expect(res.marketMedianEur).toBe(31.49);
      expect(res.currentRank).toBe(1);
    });
  });

  describe('6. Purchase Advice Precedence', () => {
    it('returns WAIT with LOW confidence when insufficient data is available', () => {
      const gameWithoutAtl: Game = { ...baseGame, historicalLowEur: undefined, historicalLowDate: undefined };
      const msrpOffer: Offer = { ...sampleOffer, priceEur: 59.99, discountPercent: 0, dealScore: 20 };
      const periodLows = calculatePeriodLows(gameWithoutAtl, [], msrpOffer);
      const emptyTypical = calculateTypicalSalePrice(59.99, []);

      const advice = evaluatePurchaseAdvice(gameWithoutAtl, msrpOffer, periodLows, emptyTypical);
      expect(advice.decision).toBe('WAIT');
      expect(advice.confidence).toBe('LOW');
      expect(advice.headline).toBe('Insufficient Price History');
    });

    it('returns WAIT with HIGH confidence when offer is flagged as anomaly', () => {
      const anomalyOffer: Offer = { ...sampleOffer, isAnomaly: true, priceEur: 0.99, anomalyReason: 'Price Glitch' };
      const periodLows = calculatePeriodLows(baseGame, [], anomalyOffer);
      const typical = { medianPriceEur: 29.99, sampleCount: 5, isLowConfidence: false };

      const advice = evaluatePurchaseAdvice(baseGame, anomalyOffer, periodLows, typical);
      expect(advice.decision).toBe('WAIT');
      expect(advice.headline).toBe('High Risk Price Anomaly');
    });

    it('returns BUY when offer matches All-Time Low', () => {
      const periodLows = calculatePeriodLows(baseGame, [], sampleOffer);
      const typical = { medianPriceEur: 34.99, sampleCount: 5, isLowConfidence: false };

      const advice = evaluatePurchaseAdvice(baseGame, sampleOffer, periodLows, typical);
      expect(advice.decision).toBe('BUY');
      expect(advice.confidence).toBe('HIGH');
    });
  });

  describe('7. Consolidated Price Intelligence Generator', () => {
    it('generates full response structure for game detail modal', () => {
      const res = generatePriceIntelligence({
        game: baseGame,
        offers: [sampleOffer],
        history: [
          { id: 'ph-1', gameId: 'game-1', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2026-08-10T12:00:00Z' }
        ]
      });

      expect(res.gameId).toBe('game-1');
      expect(res.currentPrice.priceEur).toBe(29.99);
      expect(res.periodLows.allTimeLow.priceEur).toBe(29.99);
      expect(res.advice.decision).toBe('BUY');
      expect(res.chartData.points.length).toBeGreaterThan(0);
      expect(res.historicalContextSummary).toContain('€29.99');
    });
  });
});
