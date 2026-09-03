import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from '../../src/server/db/schema.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine/evaluator.js';

describe('Migration 014 & Mega Deals Integration Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    db.exec(SEED_SOURCES_SQL);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Migration 014 purges false HIGH risk offers and dismisses false anomalies', () => {
    // Insert a test game
    db.exec(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, created_at, updated_at)
      VALUES ('game-1', 12345, 'Tales of Vesperia', 'tales-of-vesperia', 39.99, datetime('now'), datetime('now'));

      INSERT INTO merchants (id, name, code, is_official, trust_score, created_at)
      VALUES 
        ('m-1', 'G2A', 'g2a', 0, 0.7, datetime('now')),
        ('m-2', 'Kinguin', 'kinguin', 0, 0.7, datetime('now'));

      -- Falsely flagged price increase as HIGH risk
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, original_price_eur, is_valid, is_best_deal, risk_level, is_anomaly, price_event, deal_url, fetched_at, created_at, updated_at)
      VALUES ('off-1', 'game-1', 'm-1', 'STEAM_KEY', 'GLOBAL', 40.09, 39.99, 1, 0, 'HIGH', 1, 'PRICE_INCREASE', 'https://example.com/1', datetime('now'), datetime('now'), datetime('now'));

      -- Corresponding active anomaly
      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES ('anom-1', 'game-1', 'off-1', 'PRICE_GLITCH', 0.85, 'Spike in price', datetime('now'), 0);

      -- Legitimate cheap glitch that SHOULD remain high risk (sub-euro premium glitch)
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, original_price_eur, is_valid, is_best_deal, risk_level, is_anomaly, price_event, deal_url, fetched_at, created_at, updated_at)
      VALUES ('off-2', 'game-1', 'm-2', 'STEAM_KEY', 'GLOBAL', 0.49, 39.99, 1, 0, 'HIGH', 1, 'EXTREME_DROP', 'https://example.com/2', datetime('now'), datetime('now'), datetime('now'));

      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES ('anom-2', 'game-1', 'off-2', 'PRICE_GLITCH', 0.95, 'Sub-euro glitch', datetime('now'), 0);
    `);

    // Run the migration 014 logic
    db.exec(`
      UPDATE offers
      SET risk_level = 'SAFE',
          risk_score = 0.0,
          is_anomaly = 0,
          anomaly_score = 0.0,
          anomaly_reason = NULL
      WHERE risk_level = 'HIGH'
        AND (price_event = 'PRICE_INCREASE' OR price_eur >= 10.0 OR (original_price_eur IS NOT NULL AND price_eur >= original_price_eur));

      UPDATE anomalies
      SET is_dismissed = 1
      WHERE offer_id IN (
        SELECT id FROM offers WHERE risk_level != 'HIGH' AND is_anomaly = 0
      ) AND is_dismissed = 0;
    `);

    const off1 = db.prepare('SELECT risk_level, is_anomaly FROM offers WHERE id = ?').get('off-1') as any;
    expect(off1.risk_level).toBe('SAFE');
    expect(off1.is_anomaly).toBe(0);

    const anom1 = db.prepare('SELECT is_dismissed FROM anomalies WHERE id = ?').get('anom-1') as any;
    expect(anom1.is_dismissed).toBe(1);

    // Genuine sub-euro glitch remains HIGH
    const off2 = db.prepare('SELECT risk_level, is_anomaly FROM offers WHERE id = ?').get('off-2') as any;
    expect(off2.risk_level).toBe('HIGH');
    expect(off2.is_anomaly).toBe(1);

    const anom2 = db.prepare('SELECT is_dismissed FROM anomalies WHERE id = ?').get('anom-2') as any;
    expect(anom2.is_dismissed).toBe(0);
  });

  it('Mega Deal (EXTREME_DROP) properly surfaces for deep discount matching ATL', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 5.54,
      basePriceEur: 39.99,
      historicalLowEur: 5.57,
      isOfficialMerchant: false,
      sourceAgreementCount: 2,
      marketPricesEur: [5.54, 7.04]
    });

    expect(res.event).toBe('EXTREME_DROP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isAnomaly).toBe(false);
  });

  it('invalidateStaleForGameSource immediately invalidates orphaned AllKeyShop offers without affecting other sources', async () => {
    const { offerRepo, merchantRepo } = await import('../../src/server/db/index.js');

    // Create merchants
    const mG2a = merchantRepo.getOrCreate('g2a', 'G2A', false, 'https://g2a.com');
    const mCdkeys = merchantRepo.getOrCreate('cdkeys', 'CDKeys', false, 'https://cdkeys.com');

    // Insert game
    const { getDb } = await import('../../src/server/db/core.js');
    const db = getDb();
    db.exec(`
      INSERT OR IGNORE INTO games (id, steam_app_id, title, slug, base_price_eur, created_at, updated_at)
      VALUES ('game-test-stale', 99999, 'Test Stale Cleanup', 'test-stale-cleanup', 29.99, datetime('now'), datetime('now'));
    `);

    // Offer 1: From AllKeyShop (simulating old wrong match)
    const off1 = offerRepo.upsertOffer({
      gameId: 'game-test-stale',
      merchantId: mG2a.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 4.99,
      isValid: true,
      dealUrl: 'https://g2a.com/deal1',
      sourceCode: 'allkeyshop'
    });

    // Offer 2: From AllKeyShop (will remain in new match)
    const off2 = offerRepo.upsertOffer({
      gameId: 'game-test-stale',
      merchantId: mCdkeys.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 9.99,
      isValid: true,
      dealUrl: 'https://cdkeys.com/deal2',
      sourceCode: 'allkeyshop'
    });

    expect(off1.isValid).toBe(true);
    expect(off2.isValid).toBe(true);

    // Perform invalidateStaleForGameSource keeping only off2
    const result = offerRepo.invalidateStaleForGameSource('game-test-stale', 'allkeyshop', [off2.id]);
    expect(result.invalidatedCount).toBe(1);

    // Verify off1 is now invalid, off2 is still valid
    const check1 = offerRepo.getById(off1.id);
    const check2 = offerRepo.getById(off2.id);
    expect(check1?.isValid).toBe(false);
    expect(check2?.isValid).toBe(true);
  });
});
