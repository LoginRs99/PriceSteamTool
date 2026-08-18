import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from '../../src/server/routes/api.js';
import { getDb, profileRepo, gameRepo, merchantRepo, offerRepo } from '../../src/server/db/index.js';

describe('CSV Export API — GET /api/export/offers.csv', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(apiRoutes);
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
  });

  it('exports all active wishlist offers as valid CSV with correct headers and escaping', async () => {
    // 1. Create active profile
    const profile = profileRepo.create('Test User', '76561198000000001');

    // 2. Create games (including one with a comma in its title to test CSV escaping)
    const game1 = gameRepo.upsert({
      steamAppId: 1001,
      title: 'Portal 2, Special Edition',
      basePriceEur: 19.99
    });

    const game2 = gameRepo.upsert({
      steamAppId: 1002,
      title: 'Hades',
      basePriceEur: 24.99
    });

    // 3. Add to wishlist
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1001, title: 'Portal 2, Special Edition', priority: 1 },
      { steamAppId: 1002, title: 'Hades', priority: 2 }
    ]);

    // 4. Create merchants
    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const kinguinMerchant = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);

    // 5. Ingest offers
    offerRepo.upsertOffer({
      gameId: game1.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 9.99,
      dealUrl: 'https://store.steampowered.com/app/1001',
      isValid: true,
      sourceCode: 'steam'
    });

    offerRepo.upsertOffer({
      gameId: game1.id,
      merchantId: kinguinMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 4.50,
      dealUrl: 'https://kinguin.net/portal2',
      isValid: true,
      sourceCode: 'allkeyshop'
    });

    offerRepo.upsertOffer({
      gameId: game2.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 12.49,
      dealUrl: 'https://store.steampowered.com/app/1002',
      isValid: true,
      sourceCode: 'steam'
    });

    // 6. Request CSV export
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/offers.csv'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="priceSteamTool-offers-export.csv"');

    const csvBody = res.body;
    const lines = csvBody.trim().split(/\r?\n/);

    // Header validation (14 columns)
    const expectedHeader = 'game_title,merchant_name,merchant_is_official,price_eur,msrp_eur,typical_sale_median_eur,atl_eur,atl_is_confirmed,risk_level,risk_score,risk_flags,is_anomaly,is_best_deal,last_observed_at';
    expect(lines[0]).toBe(expectedHeader);

    // Exactly 1 header line + 3 offer lines
    expect(lines.length).toBe(4);

    // Comma escaping check: 'Portal 2, Special Edition' must be enclosed in double quotes
    const portalLines = lines.filter(l => l.includes('Portal 2'));
    expect(portalLines.length).toBe(2);
    for (const line of portalLines) {
      expect(line.startsWith('"Portal 2, Special Edition"')).toBe(true);
    }
  });

  it('returns valid empty CSV with headers when no active profile exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/export/offers.csv'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe('game_title,merchant_name,merchant_is_official,price_eur,msrp_eur,typical_sale_median_eur,atl_eur,atl_is_confirmed,risk_level,risk_score,risk_flags,is_anomaly,is_best_deal,last_observed_at');
  });
});
