import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { runMigrations, MIGRATIONS } from '../../src/server/db/migrations.js';
import { isPriceEqual, isPriceDifferent } from '../../src/server/domain/normalizer.js';
import { EPSILON_EUR } from '../../src/shared/types.js';
import { exchangeRateService } from '../../src/server/domain/exchangeRate.js';
import { runAnalyze } from '../../src/server/db/core.js';

describe('Step 5: Database Hygiene & Index Optimization', () => {
  it('verifies EPSILON_EUR precision and helper functions', () => {
    expect(EPSILON_EUR).toBe(0.005);
    // Exact equal
    expect(isPriceEqual(10.0, 10.0)).toBe(true);
    expect(isPriceDifferent(10.0, 10.0)).toBe(false);

    // Difference < 0.005 is treated as equal
    expect(isPriceEqual(10.0, 10.004)).toBe(true);
    expect(isPriceDifferent(10.0, 10.004)).toBe(false);

    // Difference >= 0.005 is treated as different
    expect(isPriceEqual(10.0, 10.006)).toBe(false);
    expect(isPriceDifferent(10.0, 10.006)).toBe(true);

    // null / undefined handling
    expect(isPriceEqual(null, null)).toBe(true);
    expect(isPriceEqual(undefined, undefined)).toBe(true);
    expect(isPriceEqual(10.0, null)).toBe(false);
    expect(isPriceEqual(null, 10.0)).toBe(false);
    expect(isPriceDifferent(10.0, null)).toBe(true);
  });

  it('verifies exchangeRateService tracks lastUpdatedTimestamp', () => {
    const ts = exchangeRateService.getLastUpdatedTimestamp();
    expect(typeof ts).toBe('string');
    expect(Date.parse(ts)).toBeGreaterThan(0);
  });

  it('applies migration 028 and verifies composite indexes and query plans', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    runMigrations(db);

    // 1. Verify indexes exist
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_wishlist_profile_active_priority');
    expect(indexNames).toContain('idx_offers_game_valid_error_price');

    // 2. Verify source_observations new columns
    const obsCols = db.prepare(`PRAGMA table_info(source_observations)`).all() as any[];
    const obsColNames = obsCols.map(c => c.name);
    expect(obsColNames).toContain('fx_rate');
    expect(obsColNames).toContain('fx_rate_timestamp');

    // 3. EXPLAIN QUERY PLAN on wishlist_entries query
    const explainWishlist = db.prepare(
      `EXPLAIN QUERY PLAN SELECT game_id FROM wishlist_entries WHERE profile_id = ? AND is_active = 1 ORDER BY priority ASC`
    ).all('default') as any[];
    const planTextWishlist = explainWishlist.map(r => r.detail).join(' ');
    expect(planTextWishlist).toContain('idx_wishlist_profile_active_priority');

    // 4. EXPLAIN QUERY PLAN on offers query
    const explainOffers = db.prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM offers WHERE game_id = ? AND is_valid = 1 AND is_likely_pricing_error = 0 ORDER BY price_eur ASC`
    ).all('test-game') as any[];
    const planTextOffers = explainOffers.map(r => r.detail).join(' ');
    expect(planTextOffers).toContain('idx_offers_game_valid_error_price');

    db.close();
  });

  it('runs PRAGMA optimize and ANALYZE without error', () => {
    // Calling runAnalyze() on the real DB instance
    expect(() => runAnalyze()).not.toThrow();
  });
});
