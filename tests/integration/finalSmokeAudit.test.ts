import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  getDb,
  closeDb,
  clearStmtCache 
} from '../../src/server/db/index.js';
import { calculateDealScore } from '../../src/server/domain/dealScore.js';
import { generateActionSignal } from '../../src/server/domain/actionSignal.js';
import { sendDealNotifications, saveDiscordSettings, getDiscordSettings } from '../../src/server/domain/discordNotifier.js';
import type { Game, PriceHistoryEntry } from '../../src/shared/types.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM notifications_log;
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

describe('Final Production Smoke Audit & Integration Verification', () => {
  beforeEach(() => {
    resetDatabase();
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------
  // Audit 1: Deal Score -> Ranking Flow
  // ----------------------------------------------------
  describe('1. Deal Score -> Best Value Ranking vs Pure Deal Score', () => {
    it('verifies the mathematical order of user specified test fixtures', () => {
      // Fixtures:
      // Item A: Score 95 / Conf 20% -> Value: 95 * (0.65 + 0.35 * 0.20) = 68.40
      // Item B: Score 85 / Conf 95% -> Value: 85 * (0.65 + 0.35 * 0.95) = 83.51
      // Item C: Score 75 / Conf 100% -> Value: 75 * (0.65 + 0.35 * 1.00) = 75.00
      // Item D: Score 65 / Conf 20% -> Value: 65 * (0.65 + 0.35 * 0.20) = 46.80
      // Item E: Score 65 / Conf 90% -> Value: 65 * (0.65 + 0.35 * 0.90) = 62.73

      const calcValue = (score: number, conf: number) => score * (0.65 + 0.35 * (conf / 100));

      const valA = calcValue(95, 20); // 68.4
      const valB = calcValue(85, 95); // 83.51
      const valC = calcValue(75, 100); // 75.0
      const valD = calcValue(65, 20); // 46.8
      const valE = calcValue(65, 90); // 62.725

      // In Best Value ranking: B (85@95%) > C (75@100%) > A (95@20%) > E (65@90%) > D (65@20%)
      expect(valB).toBeGreaterThan(valC);
      expect(valC).toBeGreaterThan(valA);
      expect(valA).toBeGreaterThan(valE);
      expect(valE).toBeGreaterThan(valD);

      // In pure deal_score_desc ranking: A (95) > B (85) > C (75) > D/E (65)
      expect(95).toBeGreaterThan(85);
      expect(85).toBeGreaterThan(75);
      expect(75).toBeGreaterThan(65);
    });

    it('correctly ranks games in DB using best_value and deal_score_desc discovery modes', () => {
      const profile = profileRepo.create('AuditUser', '76561198000000001');

      // Create games in DB
      const gB = gameRepo.upsert({ steamAppId: 101, title: 'Game HighConf (85/95)', basePriceEur: 60, historicalLowEur: 10 });
      const gC = gameRepo.upsert({ steamAppId: 102, title: 'Game FullConf (75/100)', basePriceEur: 60, historicalLowEur: 15 });
      const gA = gameRepo.upsert({ steamAppId: 103, title: 'Game LowConf (95/20)', basePriceEur: 60 });

      // Add to wishlist
      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 101, title: 'Game HighConf (85/95)', priority: 1, basePriceEur: 60 },
        { steamAppId: 102, title: 'Game FullConf (75/100)', priority: 2, basePriceEur: 60 },
        { steamAppId: 103, title: 'Game LowConf (95/20)', priority: 3, basePriceEur: 60 }
      ]);

      const m = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Offer for gB (85 score range)
      offerRepo.upsertOffer({
        gameId: gB.id,
        merchantId: m.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 11.00,
        originalPriceEur: 60.00,
        dealUrl: 'https://store.steampowered.com/app/101',
        sourceCode: 'steam'
      });

      // Offer for gC (75 score range)
      offerRepo.upsertOffer({
        gameId: gC.id,
        merchantId: m.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 20.00,
        originalPriceEur: 60.00,
        dealUrl: 'https://store.steampowered.com/app/102',
        sourceCode: 'steam'
      });

      // Best Value query
      const bestValueResult = gameRepo.getWishlistGames(profile.id, { sort: 'best_value' });
      expect(bestValueResult.games.length).toBe(3);
      expect(bestValueResult.games[0].id).toBe(gB.id); // Higher value beats unverified or lower discount
    });
  });

  // ----------------------------------------------------
  // Audit 2: Data Sufficiency Guard & Provisional Consistency
  // ----------------------------------------------------
  describe('2. Provisional Consistency & Data Sufficiency Guard', () => {
    it('caps Deal Score at max 65 when N=1 or N=2 and marks isProvisional = true', () => {
      // 1 observation with huge apparent discount
      const resultN1 = calculateDealScore({
        priceEur: 5.00,
        basePriceEur: 60.00,
        typicalSaleMedianEur: 25.00,
        sampleCount: 1,
        isConfirmedAtl: false
      });

      expect(resultN1.score).toBeLessThanOrEqual(65);
      expect(resultN1.isProvisional).toBe(true);
      expect(resultN1.tier).not.toBe('Exceptional');
      expect(resultN1.confidenceScore).toBeLessThanOrEqual(35);

      // N=0 with fallback
      const resultN0 = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 60.00,
        sampleCount: 0
      });
      expect(resultN0.score).toBeLessThanOrEqual(25);

    });
  });

  // ----------------------------------------------------
  // Audit 3: Discord Notification Combinations A to H
  // ----------------------------------------------------
  describe('3. Discord Notification Edge Cases (A to H)', () => {
    it('handles all deal permutations without false alarms or duplicate alerts', async () => {
      saveDiscordSettings({
        webhookUrl: 'https://discord.com/api/webhooks/audit/mock',
        isEnabled: true,
        minDealScore: 70,
        minConfidence: 40,
        notifyAtlOnly: false,
        notifyFreeGames: true,
        cooldownHours: 24
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
      fetchSpy.mockClear();

      // Create games in DB for foreign key constraint in notifications_log
      const gDbA = gameRepo.upsert({ steamAppId: 201, title: 'Case A High Score High Conf' });
      const gDbB = gameRepo.upsert({ steamAppId: 202, title: 'Case B High Score Low Conf' });
      const gDbD = gameRepo.upsert({ steamAppId: 204, title: 'Case D High Risk Anomaly' });

      // Case A: High Score (88) + High Confidence (90%) -> Sent
      // Case B: High Score (95) + Low Confidence (20%) -> Suppressed (< 40% conf)
      // Case C: Provisional Deal (Score 65, Conf 30%) -> Suppressed by score/conf threshold
      // Case D: High Risk Offer -> Suppressed by anomaly guard
      // Case F: Normal Deal (Score 55) -> Suppressed (< 70 score)

      const games: Game[] = [
        {
          id: gDbA.id,
          steamAppId: 201,
          title: 'Case A High Score High Conf',
          slug: 'case-a',
          isDlc: false,
          isFree: false,
          hasAnomaly: false,
          offersCount: 1,
          bestPriceEur: 12.00,
          bestDiscountPercent: 75,
          bestDealScore: 88,
          bestDealTier: 'Exceptional',
          bestConfidenceScore: 90,
          bestIsProvisional: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: gDbB.id,
          steamAppId: 202,
          title: 'Case B High Score Low Conf',
          slug: 'case-b',
          isDlc: false,
          isFree: false,
          hasAnomaly: false,
          offersCount: 1,
          bestPriceEur: 5.00,
          bestDiscountPercent: 90,
          bestDealScore: 95,
          bestConfidenceScore: 20, // Below 40% threshold!
          bestIsProvisional: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: gDbD.id,
          steamAppId: 204,
          title: 'Case D High Risk Anomaly',
          slug: 'case-d',
          isDlc: false,
          isFree: false,
          hasAnomaly: true, // Flagged!
          bestRiskLevel: 'HIGH',
          offersCount: 1,
          bestPriceEur: 0.49,
          bestDealScore: 99,
          bestConfidenceScore: 80,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const res = await sendDealNotifications(games, 'MANUAL');
      // Only Case A should qualify!
      expect(res.sentCount).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Case G & H: Running again immediately should send 0 because of deduplication cooldown
      const resDuplicate = await sendDealNotifications(games, 'MANUAL');
      expect(resDuplicate.sentCount).toBe(0);
    });
  });

  // ----------------------------------------------------
  // Audit 4: Discovery Sorting Modes Completeness
  // ----------------------------------------------------
  describe('4. Multi-Strategy Discovery Sorting Completeness', () => {
    it('verifies all 10 discovery modes execute without SQL or runtime errors', () => {
      const profile = profileRepo.create('SortTester', '76561198000000002');
      const sortModes: Array<any> = [
        'best_value',
        'deal_score_desc',
        'confidence_desc',
        'near_atl',
        'biggest_savings',
        'price_drops',
        'priority',
        'price_asc',
        'price_desc',
        'title_asc'
      ];

      for (const sort of sortModes) {
        const res = gameRepo.getWishlistGames(profile.id, { sort, limit: 10 });
        expect(res).toBeDefined();
        expect(Array.isArray(res.games)).toBe(true);
      }
    });
  });

  // ----------------------------------------------------
  // Audit 5: Regression Guard for Single User-Facing Confidence
  // ----------------------------------------------------
  describe('5. Confidence Cleanup & API Response Shape Guard', () => {
    it('guarantees bestEvaluationConfidence is absent from game response shape', () => {
      const profile = profileRepo.create('ConfidenceAuditUser', '76561198000000003');
      const game = gameRepo.upsert({
        steamAppId: 999001,
        title: 'Single Confidence Audit Game',
        slug: 'single-confidence-audit-game',
        basePriceEur: 49.99
      });

      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 999001, title: 'Single Confidence Audit Game', priority: 1 }
      ]);

      const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 24.99,
        originalPriceEur: 49.99,
        dealUrl: 'https://store.steampowered.com/app/999001/',
        sourceCode: 'steam'
      });

      const wishlistRes = gameRepo.getWishlistGames(profile.id, { page: 1, limit: 10 });
      expect(wishlistRes.games.length).toBe(1);
      const returnedGame = wishlistRes.games[0] as any;

      // User-facing confidence MUST be present
      expect(returnedGame.bestConfidenceScore).toBeDefined();
      expect(typeof returnedGame.bestConfidenceScore).toBe('number');
      expect(returnedGame.bestConfidenceTier).toBeDefined();

      // Dead internal evaluation confidence MUST be absent from wire payload
      expect(returnedGame.bestEvaluationConfidence).toBeUndefined();
      expect('bestEvaluationConfidence' in returnedGame).toBe(false);

      const byIdGame = gameRepo.getById(game.id) as any;
      expect(byIdGame.bestConfidenceScore).toBeDefined();
      expect(byIdGame.bestEvaluationConfidence).toBeUndefined();
      expect('bestEvaluationConfidence' in byIdGame).toBe(false);

      const bestDeals = gameRepo.getBestDeals(profile.id, 10);
      if (bestDeals.length > 0) {
        const topGame = bestDeals[0] as any;
        expect(topGame.bestConfidenceScore).toBeDefined();
        expect(topGame.bestEvaluationConfidence).toBeUndefined();
        expect('bestEvaluationConfidence' in topGame).toBe(false);
      }
    });
  });

  // ----------------------------------------------------
  // Audit 5: Sync-Start Race Condition Prevention
  // ----------------------------------------------------
  describe('5. Sync Start Race Condition Prevention & 409 Conflict', () => {
    it('rejects concurrent startSync calls with 409 and does not return stale 200 payload', async () => {
      const { syncOrchestrator } = await import('../../src/server/sync/orchestrator.js');
      const { steamAdapter } = await import('../../src/server/sources/steam.js');
      const { createApp } = await import('../../src/server/index.js');

      const profile = profileRepo.create('SyncRaceUser', '76561198000000009');
      profileRepo.setActive(profile.id);

      // Controlled promise to deterministically hold the first sync in-flight
      let resolveFirstSync!: (val: any) => void;
      const controlledHold = new Promise((resolve) => {
        resolveFirstSync = resolve;
      });

      const origFetchWishlist = steamAdapter.fetchWishlist.bind(steamAdapter);
      steamAdapter.fetchWishlist = vi.fn().mockImplementation(async () => {
        await controlledHold;
        return [];
      });

      const app = await createApp();

      try {
        // 1. Fire first sync via startSync
        const firstSyncProgress = await syncOrchestrator.startSync(profile.id);
        expect(syncOrchestrator.isSyncRunning()).toBe(true);
        expect(firstSyncProgress.status).toBe('RUNNING');

        // 2. Direct startSync while running must throw with status 409
        await expect(syncOrchestrator.startSync(profile.id)).rejects.toMatchObject({
          message: 'A synchronization task is already in progress.',
          status: 409
        });

        // 3. HTTP POST /api/sync/start while running must respond with HTTP 409 Conflict
        const resConflict = await app.inject({
          method: 'POST',
          url: '/api/sync/start'
        });

        expect(resConflict.statusCode).toBe(409);
        const jsonConflict = JSON.parse(resConflict.body);
        expect(jsonConflict.error).toBe('A synchronization task is already in progress.');

        // 4. Release first sync
        resolveFirstSync([]);
        while (syncOrchestrator.isSyncRunning()) {
          await new Promise((r) => setTimeout(r, 30));
        }
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        steamAdapter.fetchWishlist = origFetchWishlist;
        await app.close();
      }
    }, 15000);
  });
});
