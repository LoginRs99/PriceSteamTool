import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { purchaseRepo } from '../../src/server/db/repositories/purchase.js';
import { getDb, closeDb } from '../../src/server/db/core.js';
import { createApp } from '../../src/server/index.js';
import type { FastifyInstance } from 'fastify';

describe('Step 9: Purchase Journal & Savings Tracker Suite', () => {
  it('applies migration 030 and verifies purchases table and indexes', () => {
    const memDb = new Database(':memory:');
    memDb.exec(SCHEMA_SQL);
    runMigrations(memDb);

    const tables = memDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[];
    expect(tables.map(t => t.name)).toContain('purchases');

    const indexes = memDb.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as any[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_purchases_profile_date');
    expect(indexNames).toContain('idx_purchases_game');

    memDb.close();
  });

  describe('Repository and API Purchase Behavior', () => {
    let app: FastifyInstance;
    let db: Database.Database;

    beforeEach(async () => {
      app = await createApp();
      db = getDb();

      // Clean slate
      db.prepare(`DELETE FROM purchases`).run();
      db.prepare(`DELETE FROM offers`).run();
      db.prepare(`DELETE FROM games`).run();
      db.prepare(`DELETE FROM merchants`).run();
      db.prepare(`DELETE FROM profiles`).run();

      // Seed profile, game with MSRP and median, and merchant
      db.prepare(`
        INSERT INTO profiles (id, name, steam_id, is_active, created_at, updated_at)
        VALUES ('prof-1', 'Gamer Profile', '76561198000000001', 1, datetime('now'), datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, typical_sale_median_eur, created_at, updated_at)
        VALUES ('game-witcher', 292030, 'The Witcher 3: Wild Hunt', 'the-witcher-3', 29.99, 9.99, datetime('now'), datetime('now')),
               ('game-cyberpunk', 1091500, 'Cyberpunk 2077', 'cyberpunk-2077', 59.99, 29.99, datetime('now'), datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO merchants (id, code, name, is_official, created_at)
        VALUES ('m-gog', 'gog', 'GOG.com', 1, datetime('now')),
               ('m-steam', 'steam', 'Steam', 1, datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, fetched_at, created_at, updated_at)
        VALUES ('off-witcher', 'game-witcher', 'm-gog', 'STEAM_KEY', 'GLOBAL', 4.99, 'https://example.com/witcher', 1, 1, datetime('now'), datetime('now'), datetime('now'))
      `).run();
    });

    afterEach(async () => {
      closeDb();
      await app.close();
    });

    it('records purchase and snapshots MSRP & typical median savings accurately', () => {
      const p = purchaseRepo.record({
        profileId: 'prof-1',
        gameId: 'game-witcher',
        offerId: 'off-witcher',
        priceEur: 4.99,
        purchasedAt: '2026-09-15T12:00:00.000Z',
        notes: 'Bought during Autumn Sale'
      });

      expect(p.id).toBeTruthy();
      expect(p.gameTitle).toBe('The Witcher 3: Wild Hunt');
      expect(p.merchantName).toBe('GOG.com');
      expect(p.priceEur).toBe(4.99);
      expect(p.msrpEur).toBe(29.99);
      expect(p.typicalMedianEur).toBe(9.99);
      // Savings vs MSRP: 29.99 - 4.99 = 25.00
      expect(p.savingsVsMsrpEur).toBe(25);
      // Savings vs Median: 9.99 - 4.99 = 5.00
      expect(p.savingsVsMedianEur).toBe(5);
    });

    it('aggregates savings summary across multiple purchases and groups by month', () => {
      purchaseRepo.record({
        profileId: 'prof-1',
        gameId: 'game-witcher',
        merchantId: 'm-gog',
        priceEur: 4.99,
        purchasedAt: '2026-09-10T10:00:00.000Z'
      });

      purchaseRepo.record({
        profileId: 'prof-1',
        gameId: 'game-cyberpunk',
        merchantId: 'm-steam',
        priceEur: 19.99,
        purchasedAt: '2026-09-20T10:00:00.000Z'
      });

      // Different month: August 2026
      purchaseRepo.record({
        profileId: 'prof-1',
        gameId: 'game-witcher',
        merchantId: 'm-steam',
        priceEur: 7.99,
        purchasedAt: '2026-08-05T10:00:00.000Z'
      });

      const summary = purchaseRepo.getSavingsSummary('prof-1');
      expect(summary.totalPurchases).toBe(3);
      // Total spent: 4.99 + 19.99 + 7.99 = 32.97
      expect(summary.totalSpentEur).toBe(32.97);

      // Monthly breakdown
      expect(summary.monthly.length).toBe(2);
      const sep = summary.monthly.find(m => m.month === '2026-09');
      const aug = summary.monthly.find(m => m.month === '2026-08');

      expect(sep).toBeDefined();
      expect(sep?.count).toBe(2);
      expect(sep?.spentEur).toBe(24.98); // 4.99 + 19.99
      expect(sep?.savedVsMsrpEur).toBe(65); // (29.99 - 4.99 = 25) + (59.99 - 19.99 = 40)

      expect(aug).toBeDefined();
      expect(aug?.count).toBe(1);
      expect(aug?.spentEur).toBe(7.99);
      expect(aug?.savedVsMsrpEur).toBe(22); // 29.99 - 7.99 = 22
    });

    it('interacts via HTTP API: POST, GET, DELETE /api/purchases and GET /api/purchases/savings', async () => {
      // 1. POST /api/purchases
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/purchases',
        payload: {
          gameId: 'game-cyberpunk',
          merchantId: 'm-steam',
          priceEur: 19.99,
          notes: 'Steam Cyberpunk discount'
        }
      });
      expect(postRes.statusCode).toBe(201);
      const created = JSON.parse(postRes.body);
      expect(created.id).toBeTruthy();
      expect(created.gameTitle).toBe('Cyberpunk 2077');
      expect(created.savingsVsMsrpEur).toBe(40);

      // 2. GET /api/purchases
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/purchases'
      });
      expect(getRes.statusCode).toBe(200);
      const list = JSON.parse(getRes.body);
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(created.id);

      // 3. GET /api/purchases/savings
      const savingsRes = await app.inject({
        method: 'GET',
        url: '/api/purchases/savings'
      });
      expect(savingsRes.statusCode).toBe(200);
      const savings = JSON.parse(savingsRes.body);
      expect(savings.totalPurchases).toBe(1);
      expect(savings.totalSpentEur).toBe(19.99);
      expect(savings.totalSavedVsMsrpEur).toBe(40);

      // 4. DELETE /api/purchases/:id
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/purchases/${created.id}`
      });
      expect(delRes.statusCode).toBe(200);

      // 5. Verify list is empty after deletion
      const getAfterDel = await app.inject({
        method: 'GET',
        url: '/api/purchases'
      });
      expect(JSON.parse(getAfterDel.body).length).toBe(0);
    });
  });
});
