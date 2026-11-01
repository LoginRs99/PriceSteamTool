import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { MIGRATIONS } from '../../src/server/db/migrations.js';
import { buildWishlistFilterClause } from '../../src/server/db/repositories/game.js';
import { formatDropTimeAgo } from '../../src/client/src/components/GameCard.js';
import { getGameSubscriptions } from '../../src/server/domain/subscriptions.js';
import { analyzeDiscountCycle } from '../../src/server/domain/actionSignal/saleCycle.js';

describe('Deal Intelligence Suite (Dual ATLs, Fresh Drops, Sale Cadence, Subscriptions)', () => {
  it('Migration 037 adds official store low columns and correctly backfills from official stores only', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    // Run migrations 001 through 036
    for (const m of MIGRATIONS.slice(0, 36)) {
      m.up(db);
    }

    // Ensure games, merchants, price_history tables exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        steam_app_id INTEGER UNIQUE,
        title TEXT,
        historical_low_eur REAL,
        historical_low_source TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        name TEXT,
        is_official INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        merchant_id TEXT,
        source_code TEXT,
        price_eur REAL,
        is_pricing_error INTEGER DEFAULT 0,
        recorded_at TEXT
      );
    `);

    // Seed test merchants: Steam (official=1), Kinguin (official=0)
    db.exec(`
      INSERT INTO merchants (id, code, name, is_official, created_at) VALUES
      ('m-steam', 'steam', 'Steam Store', 1, datetime('now')),
      ('m-kinguin', 'kinguin', 'Kinguin', 0, datetime('now'));

      INSERT INTO games (id, steam_app_id, title, slug, historical_low_eur, historical_low_source, created_at, updated_at) VALUES
      ('g-1', 101, 'Test Game One', 'test-game-one', 3.50, 'Kinguin', datetime('now'), datetime('now'));

      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, is_pricing_error, recorded_at) VALUES
      ('ph-1', 'g-1', 'm-kinguin', 'kinguin', 3.50, 0, '2026-05-01T12:00:00Z'),
      ('ph-2', 'g-1', 'm-steam', 'steam', 7.99, 0, '2026-06-01T12:00:00Z'),
      ('ph-3', 'g-1', 'm-steam', 'steam', 5.99, 0, '2026-08-01T12:00:00Z');
    `);

    // Run Migration 037
    const m037 = MIGRATIONS.find(m => m.name === '037_add_official_store_historical_low');
    expect(m037).toBeDefined();
    m037!.up(db);

    const game = db.prepare(`SELECT * FROM games WHERE id = 'g-1'`).get() as any;
    expect(game.historical_low_eur).toBe(3.50); // Global / keyshop low
    expect(game.official_historical_low_eur).toBe(5.99); // Lowest official store price (Steam 5.99)
    expect(game.official_historical_low_source).toBe('Steam Store');
    expect(game.official_historical_low_date).toBe('2026-08-01T12:00:00Z');

    // Test updating with a new lower official low
    db.prepare(`
      UPDATE games 
      SET official_historical_low_eur = ?, 
          official_historical_low_date = ?, 
          official_historical_low_source = ?
      WHERE id = ? AND (official_historical_low_eur IS NULL OR ? < official_historical_low_eur)
    `).run(4.99, '2026-10-31T12:00:00Z', 'Fanatical', 'g-1', 4.99);

    const updated = db.prepare(`SELECT * FROM games WHERE id = 'g-1'`).get() as any;
    expect(updated.official_historical_low_eur).toBe(4.99);
    expect(updated.official_historical_low_source).toBe('Fanatical');

    // Test that a higher price does not overwrite
    db.prepare(`
      UPDATE games 
      SET official_historical_low_eur = ?, 
          official_historical_low_date = ?, 
          official_historical_low_source = ?
      WHERE id = ? AND (official_historical_low_eur IS NULL OR ? < official_historical_low_eur)
    `).run(8.99, '2026-11-01T12:00:00Z', 'Steam Store', 'g-1', 8.99);

    const notOverwritten = db.prepare(`SELECT * FROM games WHERE id = 'g-1'`).get() as any;
    expect(notOverwritten.official_historical_low_eur).toBe(4.99);

    db.close();
  });

  it('Migration 038 adds sale cadence and subscriptions columns and backfills correctly', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    for (const m of MIGRATIONS.slice(0, 37)) {
      m.up(db);
    }

    // Seed test merchants and games
    db.exec(`
      INSERT INTO merchants (id, code, name, is_official, created_at) VALUES
      ('m-steam', 'steam', 'Steam Store', 1, datetime('now'));

      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, created_at, updated_at) VALUES
      ('g-halo', 976730, 'Halo: The Master Chief Collection', 'halo-mcc', 39.99, datetime('now'), datetime('now')),
      ('g-ds', 1693980, 'Dead Space Remake', 'dead-space-remake', 59.99, datetime('now'), datetime('now')),
      ('g-indie', 999999, 'Custom Indie Game', 'custom-indie-game', 19.99, datetime('now'), datetime('now'));

      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, is_pricing_error, recorded_at) VALUES
      ('ph-indie-1', 'g-indie', 'm-steam', 'steam', 19.99, 0, '2025-01-01T00:00:00Z'),
      ('ph-indie-2', 'g-indie', 'm-steam', 'steam', 9.99, 0, '2025-01-10T00:00:00Z'),
      ('ph-indie-3', 'g-indie', 'm-steam', 'steam', 19.99, 0, '2025-01-20T00:00:00Z'),
      ('ph-indie-4', 'g-indie', 'm-steam', 'steam', 9.99, 0, '2025-08-01T00:00:00Z');
    `);

    // Run Migration 038
    const m038 = MIGRATIONS.find(m => m.name === '038_add_sale_cadence_and_subscriptions');
    expect(m038).toBeDefined();
    m038!.up(db);

    const halo = db.prepare(`SELECT * FROM games WHERE id = 'g-halo'`).get() as any;
    expect(halo.subscription_services).toContain('GAME_PASS');

    const ds = db.prepare(`SELECT * FROM games WHERE id = 'g-ds'`).get() as any;
    expect(ds.subscription_services).toContain('EA_PLAY');

    const indie = db.prepare(`SELECT * FROM games WHERE id = 'g-indie'`).get() as any;
    expect(indie.subscription_services).toBeNull();
    // 2025-01-10 to 2025-08-01 is ~203 days interval -> RARE_SALE
    expect(indie.sale_cadence).toBe('RARE_SALE');
    expect(indie.avg_days_between_sales).toBeGreaterThan(90);

    db.close();
  });

  it('getGameSubscriptions identifies Game Pass and EA Play accurately', () => {
    expect(getGameSubscriptions(976730, 'Halo MCC')).toEqual(['GAME_PASS']);
    expect(getGameSubscriptions(367520, 'Hollow Knight')).toEqual(['GAME_PASS']);
    expect(getGameSubscriptions(1693980, 'Dead Space')).toEqual(['EA_PLAY']);
    expect(getGameSubscriptions(1237970, 'Titanfall 2')).toEqual(['EA_PLAY']);
    expect(getGameSubscriptions(1245620, 'Elden Ring')).toEqual([]);
    expect(getGameSubscriptions(undefined)).toEqual([]);
  });

  it('analyzeDiscountCycle classifies frequent vs rare sale intervals correctly', () => {
    // Routine / frequent sales (every 2 weeks / ~14 days)
    const routineHistory = [
      { id: '1', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 20, discountPercent: 0, priceEvent: 'NONE' as const, isPricingError: false, recordedAt: '2026-01-01T00:00:00Z' },
      { id: '2', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 10, discountPercent: 50, priceEvent: 'STANDARD_SALE' as const, isPricingError: false, recordedAt: '2026-01-15T00:00:00Z' },
      { id: '3', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 20, discountPercent: 0, priceEvent: 'NONE' as const, isPricingError: false, recordedAt: '2026-01-20T00:00:00Z' },
      { id: '4', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 10, discountPercent: 50, priceEvent: 'STANDARD_SALE' as const, isPricingError: false, recordedAt: '2026-02-01T00:00:00Z' },
      { id: '5', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 20, discountPercent: 0, priceEvent: 'NONE' as const, isPricingError: false, recordedAt: '2026-02-05T00:00:00Z' },
      { id: '6', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 10, discountPercent: 50, priceEvent: 'STANDARD_SALE' as const, isPricingError: false, recordedAt: '2026-02-20T00:00:00Z' },
    ];
    const routineCycle = analyzeDiscountCycle(routineHistory, 20, 10);
    expect(routineCycle.saleFrequencyCategory).toBe('Frequent');
    expect(routineCycle.avgDaysBetweenSales).toBeLessThanOrEqual(35);

    // Rare sales (only on summer sale and winter sale ~180 days apart)
    const rareHistory = [
      { id: '1', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 50, discountPercent: 0, priceEvent: 'NONE' as const, isPricingError: false, recordedAt: '2025-06-01T00:00:00Z' },
      { id: '2', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 25, discountPercent: 50, priceEvent: 'STANDARD_SALE' as const, isPricingError: false, recordedAt: '2025-06-25T00:00:00Z' },
      { id: '3', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 50, discountPercent: 0, priceEvent: 'NONE' as const, isPricingError: false, recordedAt: '2025-07-10T00:00:00Z' },
      { id: '4', gameId: 'g', merchantId: 'm', merchantName: 'Steam', merchantCode: 'steam', isOfficial: true, sourceCode: 'steam' as const, priceEur: 25, discountPercent: 50, priceEvent: 'STANDARD_SALE' as const, isPricingError: false, recordedAt: '2025-12-20T00:00:00Z' },
    ];
    const rareCycle = analyzeDiscountCycle(rareHistory, 50, 25);
    expect(rareCycle.saleFrequencyCategory).toBe('Rare');
    expect(rareCycle.avgDaysBetweenSales).toBeGreaterThan(90);
  });

  it('buildWishlistFilterClause enforces rareSalesOnly and subscriptionOnly conditions', () => {
    const { whereSql: sqlRare } = buildWishlistFilterClause('profile-1', {
      rareSalesOnly: true
    });
    expect(sqlRare).toContain("g.sale_cadence = 'RARE_SALE'");

    const { whereSql: sqlSub } = buildWishlistFilterClause('profile-1', {
      subscriptionOnly: true
    });
    expect(sqlSub).toContain("g.subscription_services IS NOT NULL AND g.subscription_services != ''");
  });

  it('buildWishlistFilterClause enforces officialHistoricalLowOnly condition', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-1', {
      officialHistoricalLowOnly: true
    });

    expect(whereSql).toContain('m.is_official = 1');
    expect(whereSql).toContain('g.official_historical_low_eur IS NOT NULL');
    expect(whereSql).toContain('bo.price_eur <= g.official_historical_low_eur * 1.02');
    expect(params).toEqual(['profile-1']);
  });

  it('formatDropTimeAgo correctly formats recent price drops', () => {
    const now = Date.now();
    expect(formatDropTimeAgo(undefined)).toBeNull();
    expect(formatDropTimeAgo('invalid')).toBeNull();

    // 30 minutes ago
    const m30 = new Date(now - 30 * 60 * 1000).toISOString();
    expect(formatDropTimeAgo(m30)).toBe('Dropped just now');

    // 4 hours ago
    const h4 = new Date(now - 4 * 60 * 60 * 1000).toISOString();
    expect(formatDropTimeAgo(h4)).toBe('Dropped 4h ago');

    // 24 hours ago (yesterday)
    const d1 = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    expect(formatDropTimeAgo(d1)).toBe('Dropped yesterday');

    // 3 days ago
    const d3 = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDropTimeAgo(d3)).toBe('Dropped 3d ago');

    // 10 days ago (older than 7 days should not show badge)
    const d10 = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDropTimeAgo(d10)).toBeNull();
  });
});
