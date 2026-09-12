import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createApp } from '../../src/server/index.js';
import { config } from '../../src/server/config/index.js';
import { 
  getDb, 
  closeDb, 
  clearStmtCache, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  settingsRepo 
} from '../../src/server/db/index.js';
import { saveDiscordSettings, sendDealNotifications } from '../../src/server/domain/discordNotifier.js';
import { MIGRATIONS } from '../../src/server/db/migrations.js';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import type { Game } from '../../src/shared/types.js';

describe('VERIFICATION (Definition of Done)', () => {
  const originalDbPath = config.dbPath;

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    config.dbPath = originalDbPath;
  });

  it('Item 2: Boot test on a FRESH database: server starts, migration 024 applies, /api/health returns ok, anomalies view exists, both new indexes exist', async () => {
    const testDbPath = path.resolve(process.cwd(), 'data', 'fresh_verification_test.db');
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { force: true });
    }

    config.dbPath = testDbPath;
    closeDb();

    // Boot server on fresh database
    const app = await createApp();

    try {
      // 1. /api/health returns ok
      const healthRes = await app.inject({
        method: 'GET',
        url: '/api/health'
      });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().status).toBe('ok');

      // 2. migration 024 applied
      const db = getDb();
      const m024 = db.prepare("SELECT name FROM schema_migrations WHERE name = '024_post_migration_indexes_and_anomalies_view'").get() as any;
      expect(m024).toBeDefined();
      expect(m024.name).toBe('024_post_migration_indexes_and_anomalies_view');

      // 3. anomalies view exists
      const anomaliesObj = db.prepare("SELECT type, name FROM sqlite_master WHERE name = 'anomalies'").get() as any;
      expect(anomaliesObj).toBeDefined();
      expect(anomaliesObj.type).toBe('view');

      // 4. both new indexes exist
      const idxOffers = db.prepare("SELECT type, name FROM sqlite_master WHERE type = 'index' AND name = 'idx_offers_pricing_error'").get() as any;
      expect(idxOffers).toBeDefined();

      const idxPriceHistory = db.prepare("SELECT type, name FROM sqlite_master WHERE type = 'index' AND name = 'idx_price_history_reliable'").get() as any;
      expect(idxPriceHistory).toBeDefined();
    } finally {
      closeDb();
      await app.close();
      if (fs.existsSync(testDbPath)) {
        fs.rmSync(testDbPath, { force: true });
      }
      const walFile = `${testDbPath}-wal`;
      const shmFile = `${testDbPath}-shm`;
      if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
      if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
    }
  });

  it('Item 3: Boot test on a LEGACY simulation (anomalies table & pre-022 columns): boots cleanly, converts table to view, second boot is clean no-op', async () => {
    const legacyDbPath = path.resolve(process.cwd(), 'data', 'legacy_sim_test.db');
    if (fs.existsSync(legacyDbPath)) {
      fs.rmSync(legacyDbPath, { force: true });
    }

    // Step 1: Craft pre-022 legacy schema database
    const setupDb = new Database(legacyDbPath);
    setupDb.exec(SCHEMA_SQL);
    setupDb.exec(`
      DROP TABLE IF EXISTS pricing_errors;
      DROP VIEW IF EXISTS anomalies;
      DROP TRIGGER IF EXISTS trg_delete_anomalies;
      DROP TRIGGER IF EXISTS trg_update_anomalies;
      DROP TRIGGER IF EXISTS trg_insert_anomalies;

      -- Legacy anomalies TABLE (pre-022)
      CREATE TABLE IF NOT EXISTS anomalies (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        anomaly_type TEXT NOT NULL,
        score REAL NOT NULL,
        reason TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        is_dismissed INTEGER NOT NULL DEFAULT 0
      );

      -- Restore pre-022 legacy columns on offers
      ALTER TABLE offers DROP COLUMN is_likely_pricing_error;
      ALTER TABLE offers DROP COLUMN pricing_error_confidence;
      ALTER TABLE offers DROP COLUMN pricing_error_type;
      ALTER TABLE offers DROP COLUMN pricing_error_reason;
      ALTER TABLE offers ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE';
      ALTER TABLE offers ADD COLUMN risk_score REAL NOT NULL DEFAULT 0.0;
      ALTER TABLE offers ADD COLUMN risk_flags TEXT;
      ALTER TABLE offers ADD COLUMN evaluation_confidence REAL NOT NULL DEFAULT 1.0;
      ALTER TABLE offers ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE offers ADD COLUMN anomaly_score REAL NOT NULL DEFAULT 0.0;
      ALTER TABLE offers ADD COLUMN anomaly_reason TEXT;

      -- Restore pre-022 legacy columns on price_history
      ALTER TABLE price_history DROP COLUMN is_pricing_error;
      ALTER TABLE price_history ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE';
      ALTER TABLE price_history ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0;

      -- Insert legacy data to test migration preservation
      INSERT INTO games (id, steam_app_id, title, slug, created_at, updated_at)
      VALUES ('g-legacy-1', 999901, 'Legacy Game', 'legacy-game', datetime('now'), datetime('now'));

      INSERT INTO merchants (id, code, name, is_official, created_at)
      VALUES ('m-legacy-1', 'legacy_store', 'Legacy Store', 1, datetime('now'));

      INSERT INTO offers (id, game_id, merchant_id, price_eur, deal_url, product_type, region_type, is_anomaly, anomaly_score, anomaly_reason, fetched_at, created_at, updated_at)
      VALUES ('o-legacy-1', 'g-legacy-1', 'm-legacy-1', 1.99, 'https://example.com/deal', 'STEAM_KEY', 'GLOBAL', 1, 0.9, 'Legacy glitch reason', datetime('now'), datetime('now'), datetime('now'));

      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES ('anom-legacy-1', 'g-legacy-1', 'o-legacy-1', 'PRICE_GLITCH', 0.9, 'Legacy glitch reason', datetime('now'), 0);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);

    // Record migrations 001 to 021 as already applied
    const pre022Migrations = MIGRATIONS.filter(m => {
      const num = parseInt(m.name.split('_')[0], 10);
      return num <= 21;
    });

    const stmt = setupDb.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime('now'))");
    for (const m of pre022Migrations) {
      stmt.run(m.name);
    }
    setupDb.close();

    // Step 2: Boot server on this legacy database
    config.dbPath = legacyDbPath;
    closeDb();

    const app1 = await createApp();
    try {
      const db1 = getDb();

      // Verify anomalies is now a VIEW, not a TABLE
      const anomaliesMaster = db1.prepare("SELECT type FROM sqlite_master WHERE name = 'anomalies'").get() as any;
      expect(anomaliesMaster).toBeDefined();
      expect(anomaliesMaster.type).toBe('view');

      // Verify legacy anomaly was migrated into pricing_errors
      const migratedError = db1.prepare("SELECT * FROM pricing_errors WHERE id = 'anom-legacy-1'").get() as any;
      expect(migratedError).toBeDefined();
      expect(migratedError.offer_id).toBe('o-legacy-1');
      expect(migratedError.reason).toBe('Legacy glitch reason');

      // Verify both new indexes exist
      const idxOffers = db1.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_offers_pricing_error'").get() as any;
      expect(idxOffers).toBeDefined();
      const idxHistory = db1.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_price_history_reliable'").get() as any;
      expect(idxHistory).toBeDefined();

      // Health check works
      const res1 = await app1.inject({ method: 'GET', url: '/api/health' });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().status).toBe('ok');
    } finally {
      closeDb();
      await app1.close();
    }

    // Step 3: Second boot must be a clean no-op
    const app2 = await createApp();
    try {
      const res2 = await app2.inject({ method: 'GET', url: '/api/health' });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().status).toBe('ok');

      const db2 = getDb();
      const anomaliesMaster2 = db2.prepare("SELECT type FROM sqlite_master WHERE name = 'anomalies'").get() as any;
      expect(anomaliesMaster2.type).toBe('view');
    } finally {
      closeDb();
      await app2.close();
      if (fs.existsSync(legacyDbPath)) fs.rmSync(legacyDbPath, { force: true });
      const walFile = `${legacyDbPath}-wal`;
      const shmFile = `${legacyDbPath}-shm`;
      if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
      if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
    }
  });

  it('Item 4: Discord Glitch alert references flagged offer (€0.49 & flagged URL), not safe best deal', async () => {
    const testDbPath = path.resolve(process.cwd(), 'data', 'discord_verification_test.db');
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { force: true });
    }
    config.dbPath = testDbPath;
    closeDb();

    const db = getDb();

    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/glitch-verification',
      isEnabled: true,
      minDealScore: 70,
      minConfidence: 30,
      notifyAtlOnly: false,
      notifyFreeGames: false,
      notifyPricingErrors: true,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 999123, title: 'Borderlands Super Deluxe', slug: 'borderlands-super' });
    const game = gameRepo.getBySteamAppId(999123)!;

    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const keyshopMerchant = merchantRepo.getOrCreate('keyshop_glitch', 'Glitch Shop', false);

    // 1. Safe best deal offer: €11.99 (-80% off €59.99)
    const offerSafe = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: steamMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 11.99,
      originalPriceEur: 59.99,
      discountPercent: 80,
      dealUrl: 'https://store.steampowered.com/app/999123',
      sourceCode: 'steam'
    });

    // 2. Flagged error offer: €0.49
    const offerGlitch = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: keyshopMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      originalPriceEur: 59.99,
      discountPercent: 99,
      dealUrl: 'https://glitchshop.example.com/deal/049',
      sourceCode: 'ggdeals'
    });

    // Explicitly update offer states in DB
    db.prepare(`
      UPDATE offers 
      SET is_likely_pricing_error = 1, 
          pricing_error_type = 'DECIMAL_SHIFT', 
          pricing_error_confidence = 0.95, 
          is_valid = 1,
          is_best_deal = 0
      WHERE id = ?
    `).run(offerGlitch.id);

    db.prepare(`
      UPDATE offers 
      SET is_likely_pricing_error = 0, 
          pricing_error_confidence = 0.0,
          is_valid = 1,
          is_best_deal = 1
      WHERE id = ?
    `).run(offerSafe.id);

    const gameToNotify: Game = {
      ...game,
      hasPricingError: true,
      basePriceEur: 59.99,
      bestPriceEur: 11.99,
      bestDiscountPercent: 80,
      bestDealScore: 88,
      bestDealTier: 'Exceptional',
      bestMerchantName: 'Steam Store',
      bestMerchantIsOfficial: true,
      bestDealUrl: 'https://store.steampowered.com/app/999123',
      bestIsFresh: true,
      offersCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([gameToNotify], 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    const embed = sentPayload.embeds[0];

    // Assert description / headline identifies GLITCH HUNTER
    expect(embed.description).toContain('GLITCH HUNTER');

    // Assert embed links to flagged offer URL, NOT safe deal URL
    expect(embed.url).toBe('https://glitchshop.example.com/deal/049');
    expect(embed.url).not.toBe('https://store.steampowered.com/app/999123');

    // Assert embed price shows €0.49, NOT €11.99
    const priceField = embed.fields.find((f: any) => f.name.includes('Price'));
    expect(priceField).toBeDefined();
    expect(priceField.value).toContain('0.49');
    expect(priceField.value).not.toContain('11.99');

    closeDb();
    if (fs.existsSync(testDbPath)) fs.rmSync(testDbPath, { force: true });
    const walFile = `${testDbPath}-wal`;
    const shmFile = `${testDbPath}-shm`;
    if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
    if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
  });

  it('Item 5: ITAD history seeding sets is_official=0 for newly created keyshops (Kinguin, G2A...)', () => {
    const testDbPath = path.resolve(process.cwd(), 'data', 'seeding_verification_test.db');
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { force: true });
    }
    config.dbPath = testDbPath;
    closeDb();

    const db = getDb();
    gameRepo.upsert({ steamAppId: 888111, title: 'Seeding Test Game', slug: 'seeding-test' });
    const game = gameRepo.getBySteamAppId(888111)!;

    // Seed ITAD price history containing Kinguin, G2A, and Steam
    offerRepo.seedPriceHistoryForGame(game.id, [
      {
        timestamp: '2026-01-01T00:00:00Z',
        priceEur: 4.99,
        shopName: 'Kinguin EU'
      },
      {
        timestamp: '2026-01-02T00:00:00Z',
        priceEur: 5.49,
        shopName: 'G2A Marketplace'
      },
      {
        timestamp: '2026-01-03T00:00:00Z',
        priceEur: 9.99,
        shopName: 'Steam Store'
      }
    ]);

    // Check exact query from definition of done:
    const officialKeyshops = db.prepare(
      "SELECT name FROM merchants WHERE is_official=1 AND (LOWER(name) LIKE '%kinguin%' OR LOWER(name) LIKE '%g2a%')"
    ).all() as any[];

    expect(officialKeyshops.length).toBe(0);

    // Verify they exist as is_official = 0
    const kinguinMerchant = db.prepare("SELECT name, is_official FROM merchants WHERE code = 'kinguineu'").get() as any;
    expect(kinguinMerchant).toBeDefined();
    expect(kinguinMerchant.is_official).toBe(0);

    const g2aMerchant = db.prepare("SELECT name, is_official FROM merchants WHERE code = 'g2amarketplace'").get() as any;
    expect(g2aMerchant).toBeDefined();
    expect(g2aMerchant.is_official).toBe(0);

    const steamMerchant = db.prepare("SELECT name, is_official FROM merchants WHERE code = 'steamstore'").get() as any;
    expect(steamMerchant).toBeDefined();
    expect(steamMerchant.is_official).toBe(1);

    closeDb();
    if (fs.existsSync(testDbPath)) fs.rmSync(testDbPath, { force: true });
    const walFile = `${testDbPath}-wal`;
    const shmFile = `${testDbPath}-shm`;
    if (fs.existsSync(walFile)) fs.rmSync(walFile, { force: true });
    if (fs.existsSync(shmFile)) fs.rmSync(shmFile, { force: true });
  });
});
