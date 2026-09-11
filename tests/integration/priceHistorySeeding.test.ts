import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from '../../src/server/routes/api.js';
import { getDb, profileRepo, gameRepo, merchantRepo, offerRepo, clearStmtCache } from '../../src/server/db/index.js';
import { MIGRATIONS } from '../../src/server/db/migrations.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { priceHistoryQueue } from '../../src/server/sync/historyQueue.js';
import { config } from '../../src/server/config/index.js';

describe('One-time Price History Seeding & Backfill', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(apiRoutes);
    await app.ready();
  });

  afterAll(async () => {
    clearStmtCache();
    await app.close();
  });

  function resetDb() {
    const db = getDb();
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM notifications_log;
      DELETE FROM sync_runs;
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM games;
      DELETE FROM merchants;
      DELETE FROM profiles;
      PRAGMA foreign_keys = ON;
    `);
  }

  beforeEach(() => {
    resetDb();
    vi.restoreAllMocks();
  });

  it('verifies migration 021 idempotently adds price_history_seeded_at column', () => {
    const db = getDb();
    const mig021 = MIGRATIONS.find(m => m.name === '021_add_price_history_seeded_at');
    expect(mig021).toBeDefined();

    // Re-running migration 021 against existing database does not throw error
    expect(() => mig021!.up(db)).not.toThrow();

    // Verify column exists in table info
    const tableInfo = db.prepare(`PRAGMA table_info(games)`).all() as any[];
    const columnNames = tableInfo.map(c => c.name);
    expect(columnNames).toContain('price_history_seeded_at');
  });

  it('seeds price history into repository, updates statistical anchors and preserves idempotency', () => {
    // 1. Create a game with standard MSRP and unseeded state
    const game = gameRepo.upsert({
      steamAppId: 620,
      title: 'Portal 2',
      basePriceEur: 19.99,
      historicalLowEur: 4.99,
      historicalLowDate: '2023-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    expect(game.priceHistorySeededAt).toBeUndefined();
    expect(game.typicalSaleSampleCount).toBeUndefined();

    // 2. Mock 4 historical promotion data points from ITAD v2
    const mockPoints = [
      {
        shopName: 'Steam',
        priceEur: 1.99,
        rawPrice: 1.99,
        rawCurrency: 'EUR',
        discountPercent: 90,
        timestamp: '2024-06-20T17:00:00Z'
      },
      {
        shopName: 'Humble Store',
        priceEur: 2.99,
        rawPrice: 2.99,
        rawCurrency: 'EUR',
        discountPercent: 85,
        timestamp: '2024-03-15T12:00:00Z'
      },
      {
        shopName: 'Fanatical',
        priceEur: 2.49,
        rawPrice: 2.49,
        rawCurrency: 'EUR',
        discountPercent: 87,
        timestamp: '2023-11-25T10:00:00Z'
      },
      {
        shopName: 'Steam',
        priceEur: 3.99,
        rawPrice: 3.99,
        rawCurrency: 'EUR',
        discountPercent: 80,
        timestamp: '2023-07-05T18:00:00Z'
      }
    ];

    // 3. Seed price history
    offerRepo.seedPriceHistoryForGame(game.id, mockPoints);

    // 4. Verify seeded database state
    const seededGame = gameRepo.getById(game.id)!;
    expect(seededGame.priceHistorySeededAt).toBeDefined();
    expect(seededGame.typicalSaleSampleCount).toBe(4);
    expect(seededGame.typicalSaleMedianEur).toBeGreaterThan(0);
    expect(seededGame.typicalSaleQ1Eur).toBeGreaterThan(0);
    expect(seededGame.typicalSaleQ3Eur).toBeGreaterThan(0);

    // 5. Verify historical low updated because 1.99 < 4.99
    expect(seededGame.historicalLowEur).toBe(1.99);
    expect(seededGame.historicalLowDate).toBe('2024-06-20T17:00:00Z');
    expect(seededGame.historicalLowSource).toContain('Steam');

    // 6. Verify price_history table rows
    const historyRows = offerRepo.getPriceHistory(game.id, 50);
    expect(historyRows.length).toBe(4);
    expect(historyRows.every(h => h.isAnomaly === false)).toBe(true);

    // 7. Test Idempotency: re-seeding the exact same points does not duplicate rows
    offerRepo.seedPriceHistoryForGame(game.id, mockPoints);
    const historyRowsAfter = offerRepo.getPriceHistory(game.id, 50);
    expect(historyRowsAfter.length).toBe(4);
  });

  it('marks empty history games as seeded to avoid infinite retry loops', () => {
    const game = gameRepo.upsert({
      steamAppId: 999999,
      title: 'Obscure Indie Game',
      basePriceEur: 9.99
    });

    expect(game.priceHistorySeededAt).toBeUndefined();

    // ITAD returned empty array
    offerRepo.seedPriceHistoryForGame(game.id, []);

    const updated = gameRepo.getById(game.id)!;
    expect(updated.priceHistorySeededAt).toBeDefined();

    const history = offerRepo.getPriceHistory(game.id, 50);
    expect(history.length).toBe(0);
  });

  it('priceHistoryQueue deduplicates concurrent calls for the same game', async () => {
    const game = gameRepo.upsert({
      steamAppId: 105600,
      title: 'Terraria',
      basePriceEur: 9.99
    });

    const origApiKey = config.itadApiKey;
    try {
      (config as any).itadApiKey = 'mock-itad-api-key';

      let fetchCount = 0;
      vi.spyOn(itadAdapter, 'fetchPriceHistory').mockImplementation(async () => {
        fetchCount++;
        await new Promise(r => setTimeout(r, 50));
        return [
          {
            shopName: 'Steam',
            priceEur: 4.99,
            rawPrice: 4.99,
            rawCurrency: 'EUR',
            discountPercent: 50,
            timestamp: '2024-01-01T00:00:00Z'
          }
        ];
      });

      // Call seedGame twice concurrently for the same gameId
      const [res1, res2] = await Promise.all([
        priceHistoryQueue.seedGame(game.id),
        priceHistoryQueue.seedGame(game.id)
      ]);

      expect(res1).toBe(true);
      expect(res2).toBe(true);
      // Ensure it was only fetched once from the network
      expect(fetchCount).toBe(1);

      // Third sequential call skips because it is already seeded
      const res3 = await priceHistoryQueue.seedGame(game.id);
      expect(res3).toBe(false);
      expect(fetchCount).toBe(1);
    } finally {
      (config as any).itadApiKey = origApiKey;
    }
  });

  it('background queue processes unseeded wishlist games in priority order', async () => {
    const profile = profileRepo.create('Queue User', '76561198000000002');

    const gameLowPriority = gameRepo.upsert({ steamAppId: 2001, title: 'Game Priority 10', basePriceEur: 19.99 });
    const gameHighPriority = gameRepo.upsert({ steamAppId: 2002, title: 'Game Priority 1', basePriceEur: 29.99 });

    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 2001, priority: 10 },
      { steamAppId: 2002, priority: 1 }
    ]);

    const origApiKey = config.itadApiKey;
    try {
      (config as any).itadApiKey = 'mock-itad-api-key';

      const seededOrder: number[] = [];
      vi.spyOn(itadAdapter, 'fetchPriceHistory').mockImplementation(async (appId) => {
        seededOrder.push(appId);
        return [
          {
            shopName: 'Steam',
            priceEur: 9.99,
            rawPrice: 9.99,
            rawCurrency: 'EUR',
            discountPercent: 50,
            timestamp: '2024-01-01T00:00:00Z'
          }
        ];
      });

      await priceHistoryQueue.startBackgroundSeeding(profile.id);

      // High priority (appId 2002, priority 1) must be processed first before appId 2001 (priority 10)
      expect(seededOrder).toEqual([2002, 2001]);

      const g1 = gameRepo.getById(gameHighPriority.id)!;
      const g2 = gameRepo.getById(gameLowPriority.id)!;
      expect(g1.priceHistorySeededAt).toBeDefined();
      expect(g2.priceHistorySeededAt).toBeDefined();
    } finally {
      (config as any).itadApiKey = origApiKey;
    }
  });

  it('fast-tracks on-demand seeding when GET /api/games/:id is requested', async () => {
    const game = gameRepo.upsert({
      steamAppId: 570,
      title: 'Dota 2 Addon',
      basePriceEur: 15.00
    });

    const origApiKey = config.itadApiKey;
    try {
      (config as any).itadApiKey = 'mock-key';

      vi.spyOn(itadAdapter, 'fetchPriceHistory').mockResolvedValue([
        {
          shopName: 'Steam',
          priceEur: 7.50,
          rawPrice: 7.50,
          rawCurrency: 'EUR',
          discountPercent: 50,
          timestamp: '2024-02-01T00:00:00Z'
        },
        {
          shopName: 'Steam',
          priceEur: 5.00,
          rawPrice: 5.00,
          rawCurrency: 'EUR',
          discountPercent: 66,
          timestamp: '2023-12-01T00:00:00Z'
        },
        {
          shopName: 'Steam',
          priceEur: 6.00,
          rawPrice: 6.00,
          rawCurrency: 'EUR',
          discountPercent: 60,
          timestamp: '2023-08-01T00:00:00Z'
        }
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/games/${game.id}`
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.game.priceHistorySeededAt).toBeDefined();
      expect(body.history.length).toBe(3);
      expect(body.game.typicalSaleSampleCount).toBe(3);
    } finally {
      (config as any).itadApiKey = origApiKey;
    }
  });

  it('fast-tracks on-demand seeding when GET /api/games/:id/intelligence is requested', async () => {
    const game = gameRepo.upsert({
      steamAppId: 730,
      title: 'Counter-Strike 2',
      basePriceEur: 20.00
    });

    const origApiKey = config.itadApiKey;
    try {
      (config as any).itadApiKey = 'mock-key';

      vi.spyOn(itadAdapter, 'fetchPriceHistory').mockResolvedValue([
        {
          shopName: 'Steam',
          priceEur: 10.00,
          rawPrice: 10.00,
          rawCurrency: 'EUR',
          discountPercent: 50,
          timestamp: '2024-05-01T00:00:00Z'
        },
        {
          shopName: 'Steam',
          priceEur: 8.00,
          rawPrice: 8.00,
          rawCurrency: 'EUR',
          discountPercent: 60,
          timestamp: '2024-01-01T00:00:00Z'
        },
        {
          shopName: 'Steam',
          priceEur: 9.00,
          rawPrice: 9.00,
          rawCurrency: 'EUR',
          discountPercent: 55,
          timestamp: '2023-09-01T00:00:00Z'
        }
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/games/${game.id}/intelligence`
      });

      expect(res.statusCode).toBe(200);
      const intel = JSON.parse(res.payload);
      expect(intel.typicalSale.sampleCount).toBe(3);
      expect(intel.typicalSale.isLowConfidence).toBe(false);
      expect(intel.typicalSale.medianPriceEur).toBe(9.00);
    } finally {
      (config as any).itadApiKey = origApiKey;
    }
  });

  it('gracefully degrades without errors when ITAD_API_KEY is not configured', async () => {
    const game = gameRepo.upsert({
      steamAppId: 10001,
      title: 'No Key Game',
      basePriceEur: 19.99
    });

    const origApiKey = config.itadApiKey;
    try {
      (config as any).itadApiKey = '';

      const spy = vi.spyOn(itadAdapter, 'fetchPriceHistory');

      const res = await app.inject({
        method: 'GET',
        url: `/api/games/${game.id}/intelligence`
      });

      expect(res.statusCode).toBe(200);
      // Adapter should not be called when API key is blank
      expect(spy).not.toHaveBeenCalled();

      const gameAfter = gameRepo.getById(game.id)!;
      // Remained unseeded without crashing
      expect(gameAfter.priceHistorySeededAt).toBeUndefined();
    } finally {
      (config as any).itadApiKey = origApiKey;
    }
  });
});
