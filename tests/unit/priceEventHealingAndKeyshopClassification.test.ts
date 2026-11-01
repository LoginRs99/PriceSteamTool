import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { healOrphanedPricingErrorEvents } from '../../src/server/db/cleanData.js';
import { isKeyshopSourceStr } from '../../src/server/domain/priceIntelligence/types.js';
import { superDuperBundleAdapter } from '../../src/server/sources/superduperbundle.js';
import { nexardaAdapter } from '../../src/server/sources/nexarda.js';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from '../../src/server/db/schema.js';
import { runMigrations, MIGRATIONS } from '../../src/server/db/migrations.js';

describe('Price Event Healing and Merchant Classification', () => {
  describe('isKeyshopSourceStr', () => {
    it('identifies keyshops regardless of casing, spaces, or hyphenation', () => {
      expect(isKeyshopSourceStr('GameSeal')).toBe(true);
      expect(isKeyshopSourceStr('gameseal')).toBe(true);
      expect(isKeyshopSourceStr('HRK Game')).toBe(true);
      expect(isKeyshopSourceStr('hrk')).toBe(true);
      expect(isKeyshopSourceStr('Loaded')).toBe(true);
      expect(isKeyshopSourceStr('Electronic First')).toBe(true);
      expect(isKeyshopSourceStr('Eneba')).toBe(true);
      expect(isKeyshopSourceStr('Kinguin')).toBe(true);
      expect(isKeyshopSourceStr('G2A')).toBe(true);
      expect(isKeyshopSourceStr('GAMIVO')).toBe(true);
      expect(isKeyshopSourceStr('Instant Gaming')).toBe(true);
      expect(isKeyshopSourceStr('Difmark')).toBe(true);
      expect(isKeyshopSourceStr('Driffle')).toBe(true);
      expect(isKeyshopSourceStr('K4G')).toBe(true);
    });

    it('returns false for official publisher storefronts', () => {
      expect(isKeyshopSourceStr('Steam')).toBe(false);
      expect(isKeyshopSourceStr('Steam Store')).toBe(false);
      expect(isKeyshopSourceStr('GOG')).toBe(false);
      expect(isKeyshopSourceStr('Humble Store')).toBe(false);
      expect(isKeyshopSourceStr('Fanatical')).toBe(false);
      expect(isKeyshopSourceStr('GreenManGaming')).toBe(false);
      expect(isKeyshopSourceStr('GamesPlanet')).toBe(false);
      expect(isKeyshopSourceStr('GameBillet')).toBe(false);
      expect(isKeyshopSourceStr('DLGamer')).toBe(false);
    });
  });

  describe('SuperDuperBundle adapter merchant classification', () => {
    it('normalizes known keyshops as isOfficial = false even if SDB labels them as retailer', () => {
      const normalize = (superDuperBundleAdapter as any).normalizeOffer.bind(superDuperBundleAdapter);
      
      const gamesealOffer = normalize({
        store: 'gameseal',
        store_name: 'GameSeal',
        store_type: 'retailer',
        price: 1.24,
        drm: 'Steam',
        region: 'Global'
      }, 'https://superduperbundle.com');

      expect(gamesealOffer).not.toBeNull();
      expect(gamesealOffer?.isOfficial).toBe(false);

      const hrkOffer = normalize({
        store: 'hrk',
        store_name: 'HRK Game',
        store_type: 'retailer',
        price: 1.25,
        drm: 'Steam',
        region: 'Global'
      }, 'https://superduperbundle.com');

      expect(hrkOffer).not.toBeNull();
      expect(hrkOffer?.isOfficial).toBe(false);

      const loadedOffer = normalize({
        store: 'loaded',
        store_name: 'Loaded',
        store_type: 'retailer',
        price: 2.39,
        drm: 'Steam',
        region: 'Global'
      }, 'https://superduperbundle.com');

      expect(loadedOffer).not.toBeNull();
      expect(loadedOffer?.isOfficial).toBe(false);
    });

    it('keeps official stores as isOfficial = true', () => {
      const normalize = (superDuperBundleAdapter as any).normalizeOffer.bind(superDuperBundleAdapter);

      const steamOffer = normalize({
        store: 'steam',
        store_name: 'Steam',
        store_type: 'official',
        price: 19.99,
        drm: 'Steam',
        region: 'Global'
      }, 'https://superduperbundle.com');

      expect(steamOffer).not.toBeNull();
      expect(steamOffer?.isOfficial).toBe(true);

      const fanaticalOffer = normalize({
        store: 'fanatical',
        store_name: 'Fanatical',
        store_type: 'retailer',
        price: 14.99,
        drm: 'Steam',
        region: 'Global'
      }, 'https://superduperbundle.com');

      expect(fanaticalOffer).not.toBeNull();
      expect(fanaticalOffer?.isOfficial).toBe(true);
    });
  });

  describe('NEXARDA adapter merchant classification', () => {
    it('overrides isOfficial to false for known keyshops even if official flag was set', () => {
      const normalize = (nexardaAdapter as any).normalizeOffer.bind(nexardaAdapter);

      const enebaOffer = normalize({
        store: { name: 'Eneba', official: true },
        price: 4.10,
        available: true,
        platform: 'Steam',
        url: 'https://nexarda.co/plg/41836',
        region: 'Global'
      }, 'https://nexarda.co');

      expect(enebaOffer).not.toBeNull();
      expect(enebaOffer?.isOfficial).toBe(false);
    });
  });

  describe('healOrphanedPricingErrorEvents', () => {
    let testDb: Database.Database;

    beforeEach(async () => {
      testDb = new Database(':memory:');
      testDb.exec(SCHEMA_SQL);
      testDb.exec(SEED_SOURCES_SQL);
      runMigrations(testDb);

      vi.spyOn(await import('../../src/server/db/core.js'), 'getDb').mockReturnValue(testDb);
      vi.spyOn(await import('../../src/server/db/core.js'), 'prepareStmt').mockImplementation((sql: string) => testDb.prepare(sql));
    });

    afterEach(() => {
      vi.restoreAllMocks();
      testDb.close();
    });

    it('recomputes price_event when is_likely_pricing_error is 0 but price_event is PRICING_ERROR', () => {
      testDb.exec(`
        INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, created_at, updated_at)
        VALUES ('g-1', 851890, 'Gal*Gun 2', 'gal-gun-2', 29.99, 1.26, datetime('now'), datetime('now'));

        INSERT INTO merchants (id, code, name, is_official, created_at)
        VALUES ('m-1', 'gameseal', 'GameSeal', 0, datetime('now'));

        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, deal_url, price_eur, is_best_deal, is_valid, price_event, is_likely_pricing_error, fetched_at, created_at, updated_at)
        VALUES ('o-1', 'g-1', 'm-1', 'STEAM_KEY', 'GLOBAL', 'https://example.com/1', 1.11, 1, 1, 'PRICING_ERROR', 0, datetime('now'), datetime('now'), datetime('now'));

        INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at)
        VALUES ('so-1', 'o-1', 'superduperbundle', 1.11, datetime('now'));
      `);

      const before = testDb.prepare("SELECT price_event, is_likely_pricing_error FROM offers WHERE id = 'o-1'").get() as any;
      expect(before.price_event).toBe('PRICING_ERROR');
      expect(before.is_likely_pricing_error).toBe(0);

      const healedCount = healOrphanedPricingErrorEvents('o-1');
      expect(healedCount).toBe(1);

      const after = testDb.prepare("SELECT price_event, is_likely_pricing_error FROM offers WHERE id = 'o-1'").get() as any;
      expect(after.price_event).not.toBe('PRICING_ERROR');
      expect(['RECORD_DROP', 'UNCONFIRMED_RECORD_DROP', 'EXTREME_DROP']).toContain(after.price_event);
    });

    it('does NOT heal an active pricing error (is_likely_pricing_error = 1)', () => {
      testDb.exec(`
        INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, created_at, updated_at)
        VALUES ('g-2', 999999, 'Glitch Game', 'glitch-game', 59.99, 4.99, datetime('now'), datetime('now'));

        INSERT INTO merchants (id, code, name, is_official, created_at)
        VALUES ('m-2', 'shady-store', 'Shady Store', 0, datetime('now'));

        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, deal_url, price_eur, is_best_deal, is_valid, price_event, is_likely_pricing_error, fetched_at, created_at, updated_at)
        VALUES ('o-2', 'g-2', 'm-2', 'STEAM_KEY', 'GLOBAL', 'https://example.com/2', 0.10, 0, 1, 'PRICING_ERROR', 1, datetime('now'), datetime('now'), datetime('now'));
      `);

      const healedCount = healOrphanedPricingErrorEvents('o-2');
      expect(healedCount).toBe(0);

      const after = testDb.prepare("SELECT price_event FROM offers WHERE id = 'o-2'").get() as any;
      expect(after.price_event).toBe('PRICING_ERROR');
    });
  });

  describe('Migration 036', () => {
    it('reclassifies keyshops and heals orphaned price_event on migration upgrade', () => {
      const upgradeDb = new Database(':memory:');
      upgradeDb.exec(SCHEMA_SQL);
      upgradeDb.exec(SEED_SOURCES_SQL);

      // Run migrations up to 035 manually
      upgradeDb.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      for (const m of MIGRATIONS) {
        if (m.name === '036_heal_zombie_pricing_error_events_and_reclassify_keyshops') continue;
        m.up(upgradeDb);
        upgradeDb.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, new Date().toISOString());
      }

      // Seed pre-migration state: GameSeal as official, GOG as unofficial, and a zombie offer
      upgradeDb.exec(`
        INSERT INTO merchants (id, code, name, is_official, created_at)
        VALUES ('m-gs', 'gameseal', 'GameSeal', 1, datetime('now')),
               ('m-gog', 'gog', 'GOG', 0, datetime('now'));

        INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, created_at, updated_at)
        VALUES ('g-m', 851890, 'Gal*Gun 2', 'gal-gun-2', 29.99, 1.26, datetime('now'), datetime('now'));

        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, deal_url, price_eur, is_best_deal, is_valid, price_event, is_likely_pricing_error, fetched_at, created_at, updated_at)
        VALUES ('o-m', 'g-m', 'm-gs', 'STEAM_KEY', 'GLOBAL', 'https://example.com/gs', 1.11, 1, 1, 'PRICING_ERROR', 0, datetime('now'), datetime('now'), datetime('now'));
      `);

      // Verify pre-migration state
      expect(upgradeDb.prepare("SELECT is_official FROM merchants WHERE code = 'gameseal'").get()).toEqual({ is_official: 1 });
      expect(upgradeDb.prepare("SELECT is_official FROM merchants WHERE code = 'gog'").get()).toEqual({ is_official: 0 });
      expect(upgradeDb.prepare("SELECT price_event FROM offers WHERE id = 'o-m'").get()).toEqual({ price_event: 'PRICING_ERROR' });

      // Run migrations (which applies 036)
      runMigrations(upgradeDb);

      // Verify post-migration state
      expect(upgradeDb.prepare("SELECT is_official FROM merchants WHERE code = 'gameseal'").get()).toEqual({ is_official: 0 });
      expect(upgradeDb.prepare("SELECT is_official FROM merchants WHERE code = 'gog'").get()).toEqual({ is_official: 1 });
      const postOffer = upgradeDb.prepare("SELECT price_event FROM offers WHERE id = 'o-m'").get() as any;
      expect(postOffer.price_event).not.toBe('PRICING_ERROR');
      expect(['RECORD_DROP', 'UNCONFIRMED_RECORD_DROP', 'EXTREME_DROP']).toContain(postOffer.price_event);

      upgradeDb.close();
    });
  });
});
