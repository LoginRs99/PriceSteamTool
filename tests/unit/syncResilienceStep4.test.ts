import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDb, syncRunRepo, offerRepo, merchantRepo } from '../../src/server/db/index.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { CheapSharkSourceAdapter } from '../../src/server/sources/cheapshark.js';
import * as baseSource from '../../src/server/sources/base.js';

describe('Step 4: Sync Resilience & Database Purge Batching', () => {
  beforeEach(() => {
    circuitBreakers.resetAll();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    circuitBreakers.resetAll();
    vi.restoreAllMocks();
  });

  describe('1. sync_runs Table Persistence', () => {
    it('creates, updates, and reads sync_runs records', () => {
      const runId = `test-run-${Date.now()}`;
      const startedAt = new Date().toISOString();

      syncRunRepo.create({
        id: runId,
        triggerType: 'MANUAL',
        status: 'RUNNING',
        startedAt,
        totalGames: 100,
        processedGames: 0,
        offersFound: 0,
        offersUpdated: 0
      });

      const initial = syncRunRepo.getById(runId);
      expect(initial).not.toBeNull();
      expect(initial?.status).toBe('RUNNING');
      expect(initial?.totalGames).toBe(100);

      const completedAt = new Date().toISOString();
      syncRunRepo.update(runId, {
        status: 'COMPLETED',
        completedAt,
        processedGames: 100,
        offersFound: 450,
        offersUpdated: 450
      });

      const updated = syncRunRepo.getById(runId);
      expect(updated?.status).toBe('COMPLETED');
      expect(updated?.completedAt).toBe(completedAt);
      expect(updated?.processedGames).toBe(100);
      expect(updated?.offersFound).toBe(450);

      const latest = syncRunRepo.getLatest();
      expect(latest?.id).toBe(runId);

      const list = syncRunRepo.list(5);
      expect(list.some(r => r.id === runId)).toBe(true);
    });
  });

  describe('2. CheapShark Cross-Chunk 429 Cooldown', () => {
    it('does not launch immediate HTTP calls for subsequent chunks after 429 with large retry-after', async () => {
      const adapter = new CheapSharkSourceAdapter();

      let httpCallsCount = 0;
      vi.spyOn(baseSource, 'safeFetchJson').mockImplementation(async (url: string) => {
        if (url.includes('/stores')) {
          return [{ storeID: '1', storeName: 'Steam', isActive: 1 }];
        }
        httpCallsCount++;
        // Chunk 0 (first 25 games) returns HTTP 429 with retry-after 300s
        const err: any = new Error('HTTP 429 Too Many Requests');
        err.status = 429;
        err.retryAfterSec = 300;
        throw err;
      });

      // Prepare 75 mock games (3 chunks of 25)
      const games = Array.from({ length: 75 }, (_, i) => ({
        steamAppId: 1000 + i,
        title: `Game ${i}`
      }));

      // Expect fetchBatchPrices to throw aggregated error because all chunks fail
      await expect(adapter.fetchBatchPrices(games)).rejects.toThrow(/All 3 CheapShark chunks failed/);

      // Verify:
      // Chunk 0 hit the API once, got 429, set circuitBreakers.recordRateLimit('cheapshark', 300).
      // Chunks 1 and 2 detected isCoolingDown('cheapshark') === true and SKIPPED making HTTP calls!
      // Total calls must be 1 (only chunk 0 fired; chunks 1 and 2 did not make HTTP calls).
      expect(httpCallsCount).toBe(1);
      expect(circuitBreakers.isCoolingDown('cheapshark')).toBe(true);
      expect(circuitBreakers.getRemainingCooldownSec('cheapshark')).toBeGreaterThanOrEqual(250);
    });
  });

  describe('3. Chunked Price History Purge', () => {
    it('purges old price_history rows in chunked batches without deleting active records', () => {
      // Create a test game and merchant
      const gameId = `test-purge-game-${Date.now()}`;
      const steamAppId = Math.floor(Date.now() % 10000000) + Math.floor(Math.random() * 100000);
      getDb().prepare(`
        INSERT INTO games (id, steam_app_id, title, slug, created_at, updated_at)
        VALUES (?, ?, 'Purge Test Game', 'purge-test-game', datetime('now'), datetime('now'))
      `).run(gameId, steamAppId);

      const merchant = merchantRepo.getOrCreate('steam', 'Steam', true);

      // Insert 2500 old records (> 400 days old) and 50 fresh records (today)
      const oldDate = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
      const freshDate = new Date().toISOString();

      const insertStmt = getDb().prepare(`
        INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, is_pricing_error, recorded_at)
        VALUES (?, ?, ?, 'steam', ?, 0, ?)
      `);

      // Clean any pre-existing records older than 365 days for test isolation
      getDb().prepare(`DELETE FROM price_history WHERE recorded_at < datetime('now', '-365 days')`).run();

      const insertMany = getDb().transaction(() => {
        for (let i = 0; i < 2500; i++) {
          insertStmt.run(`old-${i}-${Date.now()}`, gameId, merchant.id, 9.99, oldDate);
        }
        for (let i = 0; i < 50; i++) {
          insertStmt.run(`fresh-${i}-${Date.now()}`, gameId, merchant.id, 14.99, freshDate);
        }
      });
      insertMany();

      const countBefore = (getDb().prepare(`SELECT count(*) as count FROM price_history WHERE game_id = ?`).get(gameId) as any).count;
      expect(countBefore).toBe(2550);

      // Execute purge with 365 days retention and 1000 batch size
      const result = offerRepo.purgeOldPriceHistory(365, 1000);
      expect(result.deletedCount).toBe(2500);

      // Only the 50 fresh records should remain
      const countAfter = (getDb().prepare(`SELECT count(*) as count FROM price_history WHERE game_id = ?`).get(gameId) as any).count;
      expect(countAfter).toBe(50);
    });
  });

  describe('4. Shared Cooldown Helper Methods', () => {
    it('correctly sets, checks, and clears cooldown across sources', () => {
      expect(circuitBreakers.isCoolingDown('steam')).toBe(false);
      expect(circuitBreakers.getRemainingCooldownSec('steam')).toBe(0);

      circuitBreakers.setCooldown('steam', 120000, 'Test 2min cooldown');
      expect(circuitBreakers.isCoolingDown('steam')).toBe(true);
      expect(circuitBreakers.getRemainingCooldownSec('steam')).toBeGreaterThan(100);

      circuitBreakers.reset('steam');
      expect(circuitBreakers.isCoolingDown('steam')).toBe(false);
      expect(circuitBreakers.getRemainingCooldownSec('steam')).toBe(0);
    });
  });
});
