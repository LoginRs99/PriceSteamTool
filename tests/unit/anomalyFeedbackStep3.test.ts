import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { pricingErrorRepo } from '../../src/server/db/repositories/pricingError.js';
import { getDb, closeDb } from '../../src/server/db/core.js';
import { createApp } from '../../src/server/index.js';
import type { FastifyInstance } from 'fastify';

describe('Step 3: Anomaly User Feedback Loop & Merchant Stats', () => {
  it('applies migration 029 and verifies user_feedback columns and indexes', () => {
    const memDb = new Database(':memory:');
    memDb.exec(SCHEMA_SQL);
    runMigrations(memDb);

    const cols = memDb.prepare(`PRAGMA table_info(pricing_errors)`).all() as any[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('user_feedback');
    expect(colNames).toContain('feedback_at');

    const indexes = memDb.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as any[];
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_pricing_errors_feedback');

    memDb.close();
  });

  describe('Repository and API Feedback Behavior', () => {
    let app: FastifyInstance;
    let db: Database.Database;

    beforeEach(async () => {
      app = await createApp();
      db = getDb();

      // Clean test slate
      db.prepare(`DELETE FROM pricing_errors`).run();
      db.prepare(`DELETE FROM offers`).run();
      db.prepare(`DELETE FROM games`).run();
      db.prepare(`DELETE FROM merchants`).run();

      // Seed mock game and merchant
      db.prepare(`
        INSERT INTO games (id, steam_app_id, title, slug, created_at, updated_at)
        VALUES ('g-test-fb', 777001, 'Feedback Test Game', 'feedback-test-game', datetime('now'), datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO merchants (id, code, name, is_official, created_at)
        VALUES ('m-store-1', 'store_one', 'Store One', 1, datetime('now')),
               ('m-store-2', 'store_two', 'Store Two', 0, datetime('now'))
      `).run();

      // Seed offer 1
      db.prepare(`
        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_likely_pricing_error, is_valid, is_best_deal, fetched_at, created_at, updated_at)
        VALUES ('o-glitch-1', 'g-test-fb', 'm-store-1', 'STEAM_KEY', 'GLOBAL', 0.99, 'https://example.com/glitch1', 1, 1, 0, datetime('now'), datetime('now'), datetime('now')),
               ('o-glitch-2', 'g-test-fb', 'm-store-2', 'STEAM_KEY', 'GLOBAL', 1.49, 'https://example.com/glitch2', 1, 1, 0, datetime('now'), datetime('now'), datetime('now'))
      `).run();

      // Seed anomalies
      db.prepare(`
        INSERT INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
        VALUES ('pe-1', 'g-test-fb', 'o-glitch-1', 'DECIMAL_SHIFT', 0.85, 'Suspicious 90% drop', datetime('now'), 0),
               ('pe-2', 'g-test-fb', 'o-glitch-2', 'SUB_EURO_PREMIUM_GLITCH', 0.75, 'Sub-euro price on premium', datetime('now'), 0)
      `).run();
    });

    afterEach(async () => {
      closeDb();
      await app.close();
    });

    it('records CONFIRMED_ERROR: stays quarantined (is_likely_pricing_error=1) and marks user_feedback', () => {
      const res = pricingErrorRepo.recordFeedback('pe-1', 'CONFIRMED_ERROR');
      expect(res).not.toBeNull();
      expect(res?.feedback).toBe('CONFIRMED_ERROR');
      expect(res?.offerId).toBe('o-glitch-1');

      // Check pricing_errors table
      const pe = db.prepare(`SELECT is_dismissed, user_feedback, feedback_at FROM pricing_errors WHERE id = 'pe-1'`).get() as any;
      expect(pe.is_dismissed).toBe(1);
      expect(pe.user_feedback).toBe('CONFIRMED_ERROR');
      expect(pe.feedback_at).toBeTruthy();

      // Offer remains flagged
      const offer = db.prepare(`SELECT is_likely_pricing_error FROM offers WHERE id = 'o-glitch-1'`).get() as any;
      expect(offer.is_likely_pricing_error).toBe(1);
    });

    it('records FALSE_POSITIVE: unflags offer (is_likely_pricing_error=0) restoring best deal eligibility', () => {
      const res = pricingErrorRepo.recordFeedback('pe-2', 'FALSE_POSITIVE');
      expect(res).not.toBeNull();
      expect(res?.feedback).toBe('FALSE_POSITIVE');
      expect(res?.offerId).toBe('o-glitch-2');

      // Check pricing_errors table
      const pe = db.prepare(`SELECT is_dismissed, user_feedback, feedback_at FROM pricing_errors WHERE id = 'pe-2'`).get() as any;
      expect(pe.is_dismissed).toBe(1);
      expect(pe.user_feedback).toBe('FALSE_POSITIVE');
      expect(pe.feedback_at).toBeTruthy();

      // Offer unflagged
      const offer = db.prepare(`SELECT is_likely_pricing_error FROM offers WHERE id = 'o-glitch-2'`).get() as any;
      expect(offer.is_likely_pricing_error).toBe(0);
    });

    it('computes per-merchant accuracy stats via getMerchantStats()', () => {
      pricingErrorRepo.recordFeedback('pe-1', 'CONFIRMED_ERROR');
      pricingErrorRepo.recordFeedback('pe-2', 'FALSE_POSITIVE');

      const stats = pricingErrorRepo.getMerchantStats();
      expect(stats.totalConfirmed).toBe(1);
      expect(stats.totalFalsePositive).toBe(1);
      expect(stats.overallPrecision).toBe(0.5);

      const storeOne = stats.merchants.find(m => m.merchantId === 'm-store-1');
      expect(storeOne).toBeDefined();
      expect(storeOne?.confirmedCount).toBe(1);
      expect(storeOne?.falsePositiveCount).toBe(0);
      expect(storeOne?.precision).toBe(1.0);

      const storeTwo = stats.merchants.find(m => m.merchantId === 'm-store-2');
      expect(storeTwo).toBeDefined();
      expect(storeTwo?.confirmedCount).toBe(0);
      expect(storeTwo?.falsePositiveCount).toBe(1);
      expect(storeTwo?.precision).toBe(0.0);
    });

    it('submits feedback via POST /api/anomalies/:id/feedback and queries GET /api/anomalies/stats', async () => {
      // 1. Submit feedback via API
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/anomalies/pe-1/feedback',
        payload: { feedback: 'CONFIRMED_ERROR' }
      });
      expect(postRes.statusCode).toBe(200);
      const postBody = JSON.parse(postRes.body);
      expect(postBody.success).toBe(true);
      expect(postBody.feedback).toBe('CONFIRMED_ERROR');

      // 2. Invalid feedback payload rejected
      const invalidRes = await app.inject({
        method: 'POST',
        url: '/api/anomalies/pe-1/feedback',
        payload: { feedback: 'INVALID_TYPE' }
      });
      expect(invalidRes.statusCode).toBe(400);

      // 3. Query stats via API
      const statsRes = await app.inject({
        method: 'GET',
        url: '/api/anomalies/stats'
      });
      expect(statsRes.statusCode).toBe(200);
      const statsBody = JSON.parse(statsRes.body);
      expect(statsBody.totalConfirmed).toBe(1);
      expect(Array.isArray(statsBody.merchants)).toBe(true);
    });
  });
});
