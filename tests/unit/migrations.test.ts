import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, MIGRATIONS } from '../../src/server/db/migrations.js';

import { SCHEMA_SQL } from '../../src/server/db/schema.js';

describe('Database Versioned Migrations Runner', () => {
  it('creates schema_migrations table and records all migrations on fresh database', () => {
    const db = new Database(':memory:');
    
    // Initial base schema
    db.exec(SCHEMA_SQL);

    runMigrations(db);

    const applied = db.prepare(`SELECT name FROM schema_migrations ORDER BY id ASC`).all() as { name: string }[];
    expect(applied.length).toBe(MIGRATIONS.length);
    expect(applied.map(a => a.name)).toEqual(MIGRATIONS.map(m => m.name));

    // Verify columns exist on tables
    const offerCols = db.prepare(`PRAGMA table_info(offers)`).all() as any[];
    const offerColNames = offerCols.map(c => c.name);
    expect(offerColNames).toContain('price_event');
    expect(offerColNames).toContain('is_likely_pricing_error');
    expect(offerColNames).toContain('pricing_error_confidence');

    // Second run: should be a no-op and not duplicate entries
    runMigrations(db);
    const appliedAfterSecondRun = db.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[];
    expect(appliedAfterSecondRun.length).toBe(MIGRATIONS.length);

    db.close();
  });

  it('Migration 032 restores invalidated AKS offers for games where all AKS offers were wiped out', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // Apply all migrations up to 031
    for (const m of MIGRATIONS) {
      if (m.name === '032_restore_uninvalidated_keyshop_offers') continue;
      m.up(db);
      db.prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run(m.name, new Date().toISOString());
    }

    // Insert dummy game and merchants
    const gameId = 'game-test-medium';
    const recentIso = new Date().toISOString();
    db.prepare(`INSERT INTO games (id, steam_app_id, title, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(gameId, 1293160, 'The Medium', 'the-medium', recentIso, recentIso);
    db.prepare(`INSERT INTO merchants (id, code, name, is_official, created_at) VALUES ('m-gameboost', 'gameboost', 'GameBoost', 0, ?)`).run(recentIso);
    db.prepare(`INSERT INTO merchants (id, code, name, is_official, created_at) VALUES ('m-k4g', 'k4g', 'K4G', 0, ?)`).run(recentIso);

    // Insert offers that were wiped to is_valid = 0 recently
    const offer1Id = 'off-gb-1';
    const offer2Id = 'off-k4g-1';

    db.prepare(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_best_deal, deal_url, fetched_at, last_observed_at, created_at, updated_at)
      VALUES (?, ?, 'm-gameboost', 'STEAM_KEY', 'GLOBAL', 4.58, 0, 0, 'https://example.com/gb', ?, ?, ?, ?)
    `).run(offer1Id, gameId, recentIso, recentIso, recentIso, recentIso);

    db.prepare(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_best_deal, deal_url, fetched_at, last_observed_at, created_at, updated_at)
      VALUES (?, ?, 'm-k4g', 'STEAM_KEY', 'GLOBAL', 4.81, 0, 0, 'https://example.com/k4g', ?, ?, ?, ?)
    `).run(offer2Id, gameId, recentIso, recentIso, recentIso, recentIso);

    db.prepare(`INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at) VALUES ('so-1', ?, 'allkeyshop', 4.58, ?)`).run(offer1Id, recentIso);
    db.prepare(`INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at) VALUES ('so-2', ?, 'allkeyshop', 4.81, ?)`).run(offer2Id, recentIso);

    // Run migration 032
    runMigrations(db);

    // Verify offers are restored
    const restoredOffers = db.prepare(`SELECT id, is_valid, is_best_deal FROM offers WHERE game_id = ? ORDER BY price_eur ASC`).all(gameId) as any[];
    expect(restoredOffers.length).toBe(2);
    expect(restoredOffers[0].is_valid).toBe(1);
    expect(restoredOffers[0].is_best_deal).toBe(1); // 4.58 is best deal
    expect(restoredOffers[1].is_valid).toBe(1);
    expect(restoredOffers[1].is_best_deal).toBe(0);

    // Verify game's allkeyshop_last_price_eur is restored
    const gameRow = db.prepare(`SELECT allkeyshop_last_price_eur FROM games WHERE id = ?`).get(gameId) as any;
    expect(gameRow.allkeyshop_last_price_eur).toBe(4.58);

    db.close();
  });
});
