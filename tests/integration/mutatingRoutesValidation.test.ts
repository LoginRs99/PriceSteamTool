import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from '../../src/server/routes/api.js';
import { v1Routes } from '../../src/server/routes/v1.js';
import { getDb, profileRepo, gameRepo } from '../../src/server/db/index.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { resetRateLimits } from '../../src/server/routes/rateLimit.js';

describe('Zod Validation on Mutating Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(apiRoutes);
    await app.register(v1Routes);
    await app.ready();
  });

  afterAll(async () => {
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
    resetRateLimits();
    vi.restoreAllMocks();
  });

  describe('POST /api/wishlist/:gameId/target-price', () => {
    it('rejects non-numeric, negative, or missing targetPriceEur with 400', async () => {
      const profile = profileRepo.create('Gamer', '76561198000000001');
      profileRepo.setActive(profile.id);
      const game = gameRepo.upsert({ steamAppId: 105600, title: 'Terraria', basePriceEur: 9.99 });

      // Invalid string
      const resString = await app.inject({
        method: 'POST',
        url: `/api/wishlist/${game.id}/target-price`,
        payload: { targetPriceEur: 'abc' }
      });
      expect(resString.statusCode).toBe(400);

      // Negative number
      const resNeg = await app.inject({
        method: 'POST',
        url: `/api/wishlist/${game.id}/target-price`,
        payload: { targetPriceEur: -10 }
      });
      expect(resNeg.statusCode).toBe(400);

      // Missing field
      const resEmpty = await app.inject({
        method: 'POST',
        url: `/api/wishlist/${game.id}/target-price`,
        payload: {}
      });
      expect(resEmpty.statusCode).toBe(400);
    });

    it('accepts valid positive number or null, preserving clamp and response shape', async () => {
      const profile = profileRepo.create('Gamer', '76561198000000001');
      profileRepo.setActive(profile.id);
      const game = gameRepo.upsert({ steamAppId: 105600, title: 'Terraria', basePriceEur: 9.99 });
      gameRepo.syncWishlistEntries(profile.id, [{
        steamAppId: 105600,
        title: 'Terraria',
        priority: 1,
        isDlc: false,
        isFree: false
      }]);

      // Set target price
      const resValid = await app.inject({
        method: 'POST',
        url: `/api/wishlist/${game.id}/target-price`,
        payload: { targetPriceEur: 4.99 }
      });
      expect(resValid.statusCode).toBe(200);
      const bodyValid = JSON.parse(resValid.body);
      expect(bodyValid).toEqual({
        success: true,
        gameId: game.id,
        targetPriceEur: 4.99
      });

      // Clear target price with null
      const resNull = await app.inject({
        method: 'POST',
        url: `/api/wishlist/${game.id}/target-price`,
        payload: { targetPriceEur: null }
      });
      expect(resNull.statusCode).toBe(200);
      const bodyNull = JSON.parse(resNull.body);
      expect(bodyNull).toEqual({
        success: true,
        gameId: game.id,
        targetPriceEur: null
      });
    });
  });

  describe('PUT /api/profiles/:id/family', () => {
    it('rejects invalid isFamily types with 400', async () => {
      const profile = profileRepo.create('Gamer', '76561198000000001');

      const resInvalid = await app.inject({
        method: 'PUT',
        url: `/api/profiles/${profile.id}/family`,
        payload: { isFamily: 'not-a-boolean' }
      });
      expect(resInvalid.statusCode).toBe(400);
    });

    it('accepts valid boolean isFamily and preserves toggle-when-absent', async () => {
      const profile = profileRepo.create('Gamer', '76561198000000001', undefined, undefined, false);

      // Explicit set to true
      const resTrue = await app.inject({
        method: 'PUT',
        url: `/api/profiles/${profile.id}/family`,
        payload: { isFamily: true }
      });
      expect(resTrue.statusCode).toBe(200);
      expect(JSON.parse(resTrue.body)).toEqual({ success: true, isFamily: true });

      // Toggle when absent (from true -> false)
      const resToggle1 = await app.inject({
        method: 'PUT',
        url: `/api/profiles/${profile.id}/family`,
        payload: {}
      });
      expect(resToggle1.statusCode).toBe(200);
      expect(JSON.parse(resToggle1.body)).toEqual({ success: true, isFamily: false });

      // Toggle when absent (from false -> true)
      const resToggle2 = await app.inject({
        method: 'PUT',
        url: `/api/profiles/${profile.id}/family`,
        payload: {}
      });
      expect(resToggle2.statusCode).toBe(200);
      expect(JSON.parse(resToggle2.body)).toEqual({ success: true, isFamily: true });
    });
  });

  describe('POST /api/v1/games/:id/refresh', () => {
    it('maps "not found" error to 404 before 500 fallback', async () => {
      const game = gameRepo.upsert({ steamAppId: 105600, title: 'Terraria', basePriceEur: 9.99 });

      // Mock syncOrchestrator.refreshGame throwing "not found"
      vi.spyOn(syncOrchestrator, 'refreshGame').mockRejectedValueOnce(
        new Error('Game 105600 not found in database')
      );

      const resNotFound = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${game.id}/refresh`,
        payload: {}
      });
      expect(resNotFound.statusCode).toBe(404);
      expect(JSON.parse(resNotFound.body)).toEqual({
        error: 'Game 105600 not found in database'
      });

      // Mock syncOrchestrator.refreshGame throwing other error
      vi.spyOn(syncOrchestrator, 'refreshGame').mockRejectedValueOnce(
        new Error('Database disk error')
      );

      const resOther = await app.inject({
        method: 'POST',
        url: `/api/v1/games/${game.id}/refresh`,
        payload: {}
      });
      expect(resOther.statusCode).toBe(500);
      expect(JSON.parse(resOther.body)).toEqual({
        error: 'Database disk error'
      });
    });
  });
});
