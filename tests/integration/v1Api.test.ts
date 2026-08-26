import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { v1Routes } from '../../src/server/routes/v1.js';
import { getDb, profileRepo, gameRepo, merchantRepo, offerRepo, clearStmtCache } from '../../src/server/db/index.js';

describe('V1 REST API Integration & Anti-Rate-Limit Suite (/api/v1/*)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(v1Routes);
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
  });

  it('1. Provides standard IETF RateLimit and Version headers on all responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/quota'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('300');
    expect(res.headers['x-ratelimit-remaining']).toBe('299');
    expect(res.headers['x-api-version']).toBe('1.0');

    const json = JSON.parse(res.body);
    expect(json.status).toBe('HEALTHY');
    expect(json.rateLimitPerMinute).toBe(300);
  });

  it('2. GET /api/v1/games supports pagination envelope and ETag caching', async () => {
    const profile = profileRepo.create('Test User', '76561198000000001');
    const g1 = gameRepo.upsert({ steamAppId: 1001, title: 'Cyberpunk 2077', basePriceEur: 59.99 });
    const g2 = gameRepo.upsert({ steamAppId: 1002, title: 'The Witcher 3', basePriceEur: 29.99 });
    
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1001, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1002, title: 'The Witcher 3', priority: 2 }
    ]);

    // Initial fetch
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/games?limit=10'
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.data.length).toBe(2);
    expect(json.pagination.total).toBe(2);
    expect(json.pagination.page).toBe(1);

    const etag = res.headers['etag'];
    expect(etag).toBeDefined();

    // Re-request with If-None-Match header -> must return 304 Not Modified
    const cacheRes = await app.inject({
      method: 'GET',
      url: '/api/v1/games?limit=10',
      headers: { 'if-none-match': etag as string }
    });

    expect(cacheRes.statusCode).toBe(304);
  });

  it('3. GET /api/v1/games/:id supports both UUID and steam:AppID format', async () => {
    const g = gameRepo.upsert({ 
      steamAppId: 1091500, 
      title: 'Cyberpunk 2077', 
      basePriceEur: 59.99,
      historicalLowEur: 14.99,
      historicalLowDate: '2025-06-25T14:30:00Z',
      historicalLowSource: 'Steam Store'
    });

    // Lookup by UUID
    const resId = await app.inject({
      method: 'GET',
      url: `/api/v1/games/${g.id}`
    });
    expect(resId.statusCode).toBe(200);
    const jsonId = JSON.parse(resId.body);
    expect(jsonId.title).toBe('Cyberpunk 2077');
    expect(jsonId.steamAppId).toBe(1091500);

    // Lookup by steam:1091500 prefix
    const resSteam = await app.inject({
      method: 'GET',
      url: '/api/v1/games/steam:1091500'
    });
    expect(resSteam.statusCode).toBe(200);
    const jsonSteam = JSON.parse(resSteam.body);
    expect(jsonSteam.id).toBe(g.id);
    expect(jsonSteam.historicalLowEur).toBe(14.99);

    // Lookup by direct numeric AppID
    const resNumeric = await app.inject({
      method: 'GET',
      url: '/api/v1/games/1091500'
    });
    expect(resNumeric.statusCode).toBe(200);
    const jsonNumeric = JSON.parse(resNumeric.body);
    expect(jsonNumeric.id).toBe(g.id);
  });

  it('4. POST /api/v1/games/resolve handles bulk AppID and title matching', async () => {
    gameRepo.upsert({ steamAppId: 1001, title: 'Hades' });
    gameRepo.upsert({ steamAppId: 1002, title: 'Portal 2' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/games/resolve',
      payload: {
        steamAppIds: [1001, 9999],
        titles: ['Portal 2', 'Non Existent Game']
      }
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    expect(json.resolved.length).toBe(2);
    expect(json.resolved.find((r: any) => r.query === '1001')?.title).toBe('Hades');
    expect(json.resolved.find((r: any) => r.query === 'Portal 2')?.steamAppId).toBe(1002);

    expect(json.unresolved).toContain('9999');
    expect(json.unresolved).toContain('Non Existent Game');
  });

  it('5. POST /api/v1/offers/batch returns multi-game live pricing in a single payload', async () => {
    const g1 = gameRepo.upsert({ steamAppId: 1001, title: 'Game A', basePriceEur: 49.99, historicalLowEur: 10.00 });
    const g2 = gameRepo.upsert({ steamAppId: 1002, title: 'Game B', basePriceEur: 19.99, historicalLowEur: 5.00 });

    const mSteam = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const mKinguin = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);

    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: mSteam.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 24.99,
      dealUrl: 'https://store.steampowered.com/app/1001',
      isValid: true,
      sourceCode: 'steam'
    });

    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: mKinguin.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 14.50,
      voucherCode: 'AKS10',
      dealUrl: 'https://kinguin.net/deal1',
      isValid: true,
      sourceCode: 'allkeyshop'
    });

    offerRepo.upsertOffer({
      gameId: g2.id,
      merchantId: mSteam.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 9.99,
      dealUrl: 'https://store.steampowered.com/app/1002',
      isValid: true,
      sourceCode: 'steam'
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/offers/batch',
      payload: {
        steamAppIds: [1001, 1002],
        currency: 'EUR'
      }
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    expect(json.currency).toBe('EUR');
    expect(json.results['1001']).toBeDefined();
    expect(json.results['1001'].bestPriceEur).toBe(14.50);
    expect(json.results['1001'].bestMerchant).toBe('Kinguin');
    expect(json.results['1001'].voucherCode).toBe('AKS10');

    expect(json.results['1002']).toBeDefined();
    expect(json.results['1002'].bestPriceEur).toBe(9.99);
    expect(json.results['1002'].bestMerchant).toBe('Steam Store');
  });

  it('6. GET /api/v1/merchants and /api/v1/merchants/:id list stores with trust scores', async () => {
    merchantRepo.getOrCreate('steam', 'Steam Store', true);
    merchantRepo.getOrCreate('gog', 'GOG.com', true);

    const resList = await app.inject({
      method: 'GET',
      url: '/api/v1/merchants'
    });
    expect(resList.statusCode).toBe(200);
    const jsonList = JSON.parse(resList.body);
    expect(jsonList.data.length).toBeGreaterThanOrEqual(2);

    const resSingle = await app.inject({
      method: 'GET',
      url: '/api/v1/merchants/steam'
    });
    expect(resSingle.statusCode).toBe(200);
    const jsonSingle = JSON.parse(resSingle.body);
    expect(jsonSingle.name).toBe('Steam Store');
    expect(jsonSingle.isOfficial).toBe(true);
  });

  it('7. Supports Price Alert CRUD (POST / GET / DELETE /api/v1/alerts)', async () => {
    const profile = profileRepo.create('Test User', '76561198000000001');
    const game = gameRepo.upsert({ steamAppId: 1001, title: 'Alert Game', basePriceEur: 39.99 });
    gameRepo.syncWishlistEntries(profile.id, [{ steamAppId: 1001, title: 'Alert Game', priority: 1 }]);

    // Create target price alert
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts',
      payload: {
        steamAppId: 1001,
        targetPriceEur: 19.99
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createJson = JSON.parse(createRes.body);
    expect(createJson.targetPriceEur).toBe(19.99);

    // List alerts
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts'
    });
    expect(listRes.statusCode).toBe(200);
    const listJson = JSON.parse(listRes.body);
    expect(listJson.data.length).toBe(1);
    expect(listJson.data[0].targetPriceEur).toBe(19.99);

    // Delete alert
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/alerts/${game.id}`
    });
    const listEmptyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts'
    });
    const listEmptyJson = JSON.parse(listEmptyRes.body);
    expect(listEmptyJson.data.length).toBe(0);
  });

  it('8. Enforces API_TOKEN guard when configured and masks Discord Webhook URL', async () => {
    const { createApp } = await import('../../src/server/index.js');
    const { config } = await import('../../src/server/config/index.js');
    const { settingsRepo } = await import('../../src/server/db/index.js');

    settingsRepo.set('discord_webhook_url', 'https://discord.com/api/webhooks/123456789/secrettoken99');

    // 8a. Test with API_TOKEN enabled
    const origToken = config.apiToken;
    try {
      config.apiToken = 'test-secret-token-123';
      const authApp = await createApp();

      // Request without token to /api/v1/quota -> 401
      const resUnauth = await authApp.inject({
        method: 'GET',
        url: '/api/v1/quota'
      });
      expect(resUnauth.statusCode).toBe(401);

      // Request with wrong token -> 401
      const resWrong = await authApp.inject({
        method: 'GET',
        url: '/api/v1/quota',
        headers: { 'x-api-token': 'wrong-token' }
      });
      expect(resWrong.statusCode).toBe(401);

      // Health endpoint remains accessible without token
      const resHealth = await authApp.inject({
        method: 'GET',
        url: '/api/health'
      });
      expect(resHealth.statusCode).toBe(200);

      // Request with valid token -> 200 and unmasked webhook URL
      const resAuth = await authApp.inject({
        method: 'GET',
        url: '/api/settings/discord',
        headers: { 'x-api-token': 'test-secret-token-123' }
      });
      expect(resAuth.statusCode).toBe(200);
      const authJson = JSON.parse(resAuth.body);
      expect(authJson.hasWebhook).toBe(true);
      expect(authJson.webhookUrl).toBe('https://discord.com/api/webhooks/123456789/secrettoken99');
      expect(authJson.webhookUrlMasked).toBe('...oken99');

      await authApp.close();
    } finally {
      config.apiToken = origToken;
    }

    // 8b. Test default unauthenticated mode -> returns masked webhook URL
    const publicApp = await (await import('../../src/server/index.js')).createApp();
    const resPublic = await publicApp.inject({
      method: 'GET',
      url: '/api/settings/discord'
    });
    expect(resPublic.statusCode).toBe(200);
    const publicJson = JSON.parse(resPublic.body);
    expect(publicJson.hasWebhook).toBe(true);
    expect(publicJson.webhookUrl).toBe('...oken99');
    expect(publicJson.webhookUrlMasked).toBe('...oken99');
    await publicApp.close();
  });
});
