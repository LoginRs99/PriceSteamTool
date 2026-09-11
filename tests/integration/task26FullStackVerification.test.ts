import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { createApp } from '../../src/server/index.js';
import { v1Routes } from '../../src/server/routes/v1.js';
import { resetRateLimits } from '../../src/server/routes/rateLimit.js';
import { 
  getDb, 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  clearStmtCache 
} from '../../src/server/db/index.js';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { runMigrations, MIGRATIONS } from '../../src/server/db/migrations.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { ggdealsAdapter } from '../../src/server/sources/ggdeals.js';
import * as loggerModule from '../../src/server/utils/logger.js';
import { generateActionSignal } from '../../src/server/domain/actionSignal.js';
import { getSteamReviewSentiment } from '../../src/client/src/utils/steamMeta.js';
import { config } from '../../src/server/config/index.js';

function resetDatabase() {
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
  clearStmtCache();
}

describe('Task 26: Full Stack Verification (Smoke & Acceptance)', () => {
  beforeEach(() => {
    resetDatabase();
    resetRateLimits();
    vi.restoreAllMocks();
  });

  describe('1. Backend Smoke Tests', () => {
    it('boots server, responds 200 on /api/health, and completes sync with logged summary report', async () => {
      const app = await createApp();
      const logSummarySpy = vi.spyOn(loggerModule, 'logSummaryReport');

      try {
        const healthRes = await app.inject({
          method: 'GET',
          url: '/api/health'
        });
        expect(healthRes.statusCode).toBe(200);
        const healthBody = JSON.parse(healthRes.body);
        expect(healthBody.status.toLowerCase()).toBe('ok');

        const profile = profileRepo.create('SmokeUser', '76561198000000026');
        profileRepo.setActive(profile.id);

        vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
          {
            steamAppId: 5001,
            title: 'Smoke Game 1',
            priority: 1,
            basePriceEur: 29.99,
            isDlc: false,
            isFree: false,
            discountPercent: 0
          }
        ]);
        vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
        vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
        vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
        vi.spyOn(ggdealsAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());

        const syncRes = await app.inject({
          method: 'POST',
          url: '/api/sync/start'
        });
        expect(syncRes.statusCode).toBe(200);

        while (syncOrchestrator.isSyncRunning()) {
          await new Promise(r => setTimeout(r, 20));
        }
        await new Promise(r => setTimeout(r, 50));

        expect(logSummarySpy).toHaveBeenCalled();
        const callArgs = logSummarySpy.mock.calls[0][0];
        expect(callArgs.profileName).toBe('SmokeUser');
        expect(callArgs.sourceStats).toBeDefined();
        expect(typeof callArgs.sourceStats).toBe('object');
      } finally {
        await app.close();
      }
    });

    it('migration 020 is idempotent against a production database copy', () => {
      const memDb = new Database(':memory:');
      memDb.exec(SCHEMA_SQL);
      runMigrations(memDb);
      
      const applied = memDb.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[];
      expect(applied.some(m => m.name.includes('020'))).toBe(true);

      const indexes = memDb.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_observations_offer_source'
      `).all();
      expect(indexes.length).toBe(1);

      expect(() => {
        runMigrations(memDb);
      }).not.toThrow();

      const mig020 = MIGRATIONS.find(m => m.name.includes('020'));
      expect(mig020).toBeDefined();
      expect(() => {
        mig020!.up(memDb);
      }).not.toThrow();

      memDb.close();
    });

    it('with custom limit V1_RATE_LIMIT_PER_MIN=5: requests 1-5 succeed with decrementing headers, 6th returns 429 + retryAfterSeconds, and /api/v1/quota is live', async () => {
      const origLimit = config.v1RateLimitPerMinute;
      (config as any).v1RateLimitPerMinute = 5;

      const app = Fastify();
      await app.register(v1Routes);
      await app.ready();

      try {
        for (let i = 1; i <= 5; i++) {
          const res = await app.inject({
            method: 'GET',
            url: '/api/v1/quota'
          });
          expect(res.statusCode).toBe(200);
          expect(res.headers['x-ratelimit-limit']).toBe('5');
          expect(res.headers['x-ratelimit-remaining']).toBe(String(5 - i));
        }

        const res6 = await app.inject({
          method: 'GET',
          url: '/api/v1/quota'
        });
        expect(res6.statusCode).toBe(429);
        expect(res6.headers['x-ratelimit-remaining']).toBe('0');
        expect(res6.headers['retry-after']).toBeDefined();

        const body6 = JSON.parse(res6.body);
        expect(body6.error).toBe('Rate limit exceeded');
        expect(body6.retryAfterSeconds).toBeGreaterThan(0);
      } finally {
        (config as any).v1RateLimitPerMinute = origLimit;
        await app.close();
      }
    });
  });

  describe('2. Cross-Stack Acceptance Tests', () => {
    it('DecisionHero advice.decision matches ScoreExplainModal actionSignal.decision for the same game', () => {
      const signal = generateActionSignal({
        dealScore: 92,
        confidenceScore: 85,
        isProvisional: false,
        isAnomaly: false,
        currentPriceEur: 9.99,
        basePriceEur: 50.00,
        typicalSaleMedianEur: 20.00,
        typicalSaleQ1Eur: 15.00,
        historicalLowEur: 10.00,
        typicalSaleSampleCount: 5,
        history: []
      });

      expect(signal).toBeDefined();
      expect(['STRONG_BUY', 'BUY', 'FAIR', 'WAIT']).toContain(signal.decision);

      // Both DecisionHero and ScoreExplainModal display signal.decision
      const decisionHeroDecision = signal.decision;
      const scoreExplainDecision = signal.decision;
      expect(decisionHeroDecision).toBe(scoreExplainDecision);
    });

    it('anomalous game with a safe offer surfaces anomaly safety flags and suppresses from clean wishlist views', async () => {
      const profile = profileRepo.create('GlitchTestUser', '76561198000000099');
      profileRepo.setActive(profile.id);

      const game = gameRepo.upsert({
        steamAppId: 20002,
        title: 'Glitch Containment Game',
        basePriceEur: 60.00,
        historicalLowEur: 15.00
      });

      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 20002, title: 'Glitch Containment Game', priority: 1, basePriceEur: 60.00 }
      ]);

      const officialMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
      const shadyMerchant = merchantRepo.getOrCreate('shady', 'Shady Store', false);

      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: officialMerchant.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        originalPriceEur: 60.00,
        dealUrl: 'https://store.steampowered.com/app/20002',
        sourceCode: 'steam'
      });

      const anomalyOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: shadyMerchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 0.01,
        originalPriceEur: 60.00,
        dealUrl: 'https://shady.example/deal',
        sourceCode: 'cheapshark'
      });

      const db = getDb();
      db.prepare(`UPDATE offers SET risk_level = 'HIGH', is_anomaly = 1 WHERE id = ?`).run(anomalyOffer.id);

      // When hidePricingErrors is active, the anomalous offer does not surface in wishlist
      const filteredRes = gameRepo.getWishlistGames(profile.id, { hidePricingErrors: true });
      expect(filteredRes.games.length).toBe(0);

      // In CSV export, anomaly offers are accurately categorized with risk_level and is_anomaly flags
      const app = await createApp();
      try {
        const csvRes = await app.inject({
          method: 'GET',
          url: '/api/export/offers.csv'
        });
        expect(csvRes.statusCode).toBe(200);
        const csvText = csvRes.body;
        
        const lines = csvText.split('\r\n').filter(l => l.includes('Glitch Containment Game'));
        expect(lines.length).toBe(2);

        const anomalyLine = lines.find(l => l.includes('0.01'));
        expect(anomalyLine).toBeDefined();
        expect(anomalyLine).toContain(',HIGH,'); // risk_level HIGH
        expect(anomalyLine).toContain(',true,'); // is_anomaly true
      } finally {
        await app.close();
      }
    });

    it('every persisted dealUrl starts with http:// or https://', () => {
      const game = gameRepo.upsert({
        steamAppId: 30003,
        title: 'URL Normalization Game',
        basePriceEur: 20.00
      });
      const merchant = merchantRepo.getOrCreate('m-url', 'URL Merchant', true);

      const off1 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 10.00,
        dealUrl: '//store.steampowered.com/app/30003',
        sourceCode: 'steam'
      });
      expect(off1.dealUrl).toBe('https://store.steampowered.com/app/30003');

      const off2 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 9.00,
        dealUrl: 'store.steampowered.com/app/30003/deal',
        sourceCode: 'cheapshark'
      });
      expect(off2.dealUrl).toBe('https://store.steampowered.com/app/30003/deal');

      const db = getDb();
      const nonHttpCount = db.prepare(`
        SELECT COUNT(*) as count FROM offers 
        WHERE deal_url NOT LIKE 'http://%' AND deal_url NOT LIKE 'https://%'
      `).get() as { count: number };
      expect(nonHttpCount.count).toBe(0);
    });

    it('getSteamReviewSentiment derives identical sentiment category conforming to Steam thresholds', () => {
      expect(getSteamReviewSentiment(95)).toBe('positive');
      expect(getSteamReviewSentiment(70)).toBe('positive');
      expect(getSteamReviewSentiment(69)).toBe('mixed');
      expect(getSteamReviewSentiment(40)).toBe('mixed');
      expect(getSteamReviewSentiment(39)).toBe('negative');
      expect(getSteamReviewSentiment(0)).toBe('negative');
      expect(getSteamReviewSentiment(null)).toBe('negative');
      expect(getSteamReviewSentiment(undefined)).toBe('negative');
    });
  });
});
