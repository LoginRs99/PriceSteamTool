import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeFetchJson } from '../../src/server/sources/base.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { getDb, prepareStmt } from '../../src/server/db/core.js';
import { AllKeyShopPoliteQueue } from '../../src/server/sync/allkeyshop/queue.js';
import { PacedSourceQueue } from '../../src/server/sync/rateLimiter.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';

describe('SafeFetch & Offer Repository Edge Cases Suite', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM games;
      DELETE FROM merchants;
    `);
    circuitBreakers.resetAll();
  });

  describe('safeFetchJson Diagnostics & Error Handling', () => {
    it('returns parsed object on valid JSON response', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"appId": 12345, "name": "Great Game"}')
      } as any);

      try {
        const data = await safeFetchJson<{ appId: number; name: string }>('https://api.example.com/game');
        expect(data.appId).toBe(12345);
        expect(data.name).toBe('Great Game');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('throws informative error with status and text preview on HTML or malformed response', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
        text: () => Promise.resolve('<!DOCTYPE html><html><body>Attention Required! | Cloudflare</body></html>')
      } as any);

      try {
        await expect(safeFetchJson('https://store.steampowered.com/blocked')).rejects.toThrow(
          /Failed to parse JSON response from https:\/\/store\.steampowered\.com\/blocked \(status: 200, content-type: text\/html; charset=UTF-8\): <!DOCTYPE html>/
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Offer Repository: Free Game Observations & Corroboration Division Safety', () => {
    it('preserves 0 EUR free game observations as valid candidates', () => {
      const game = gameRepo.upsert({ steamAppId: 99990, title: 'Free To Play Game', basePriceEur: 0 });
      const merchant = merchantRepo.getOrCreate('steam_store', 'Steam', true);

      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        sourceCode: 'steam',
        productType: 'STORE_DIRECT',
        regionType: 'GLOBAL',
        priceEur: 0,
        rawPrice: 0,
        rawCurrency: 'EUR',
        dealUrl: 'https://store.steampowered.com/app/99990',
        isValid: true
      });

      const offers = offerRepo.getOffersForGame(game.id);
      expect(offers.length).toBe(1);
      expect(offers[0].priceEur).toBe(0);
      expect(offers[0].isValid).toBe(true);

      const sourceObs = prepareStmt(`SELECT * FROM source_observations WHERE offer_id = ?`).all(offers[0].id) as any[];
      expect(sourceObs.length).toBe(1);
      expect(Number(sourceObs[0].observed_price_eur)).toBe(0);
    });

    it('handles peer corroboration safely when both peers have 0 EUR price without division by zero', () => {
      const game = gameRepo.upsert({ steamAppId: 99991, title: 'Epic Giveaway Game', basePriceEur: 19.99 });
      const merchantSteam = merchantRepo.getOrCreate('steam_store', 'Steam', true);
      const merchantGog = merchantRepo.getOrCreate('gog_store', 'GOG', true);

      // Steam records 0 EUR observation
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchantSteam.id,
        sourceCode: 'steam',
        productType: 'STORE_DIRECT',
        regionType: 'GLOBAL',
        priceEur: 0,
        dealUrl: 'https://store.steampowered.com/app/99991',
        isValid: true
      });

      // GOG also records 0 EUR observation for same game
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchantGog.id,
        sourceCode: 'itad',
        productType: 'STORE_DIRECT',
        regionType: 'GLOBAL',
        priceEur: 0,
        dealUrl: 'https://www.gog.com/game/epic_giveaway',
        isValid: true
      });

      const offers = offerRepo.getOffersForGame(game.id);
      expect(offers.length).toBe(2);
      expect(offers.every(o => o.priceEur === 0 && o.isValid)).toBe(true);
    });
  });

  describe('Queue Cancellation & Graceful Interrupt during Cooldown', () => {
    it('AllKeyShopPoliteQueue clears and rejects pending tasks without hanging', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 50;
      queue.jitterMaxMs = 0;

      // Force circuit breaker to PAUSED with cooldown
      circuitBreakers.recordFailure('allkeyshop', 'err 1');
      circuitBreakers.recordFailure('allkeyshop', 'err 2');
      circuitBreakers.recordFailure('allkeyshop', 'err 3');
      circuitBreakers.recordFailure('allkeyshop', 'err 4');
      expect(circuitBreakers.canExecute('allkeyshop').allowed).toBe(false);

      const taskPromise = queue.enqueue('test-task', async () => 'done', 'Test Game');
      expect(queue.pendingCount).toBe(1);

      // Clear the queue
      queue.clear();
      expect(queue.pendingCount).toBe(0);

      await expect(taskPromise).rejects.toThrow('Queue for allkeyshop was cleared/cancelled');
    });

    it('PacedSourceQueue clears and rejects pending tasks without hanging', async () => {
      const queue = new PacedSourceQueue('steam', 50, 0);

      // Force steam breaker to PAUSED
      circuitBreakers.recordFailure('steam', 'err 1');
      circuitBreakers.recordFailure('steam', 'err 2');
      circuitBreakers.recordFailure('steam', 'err 3');
      circuitBreakers.recordFailure('steam', 'err 4');

      const taskPromise = queue.enqueue(async () => 'done');
      expect(queue.pendingCount).toBe(1);

      queue.clear();
      expect(queue.pendingCount).toBe(0);

      await expect(taskPromise).rejects.toThrow('Queue for steam was cleared/cancelled');
    });
  });
});
