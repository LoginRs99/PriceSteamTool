import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, prepareStmt } from '../../src/server/db/core.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { randomUUID } from 'crypto';

describe('Offer Sorting & TTL Invalidation Suite', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM games;
      DELETE FROM merchants;
    `);
  });

  it('renders available offers in uninterrupted price-ascending order regardless of freshness', () => {
    gameRepo.upsert({ steamAppId: 9001, title: 'Sort Order Game', basePriceEur: 59.99 });
    const game = gameRepo.getBySteamAppId(9001)!;

    const m1 = merchantRepo.getOrCreate('store_a', 'Store A', true);
    const m2 = merchantRepo.getOrCreate('store_b', 'Store B', false);
    const m3 = merchantRepo.getOrCreate('store_c', 'Store C', false);
    const m4 = merchantRepo.getOrCreate('store_d', 'Store D', false);

    const now = new Date();
    const freshIso = now.toISOString();
    // 5 days ago (>72 hours, so stale)
    const staleIso = new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString();

    // Insert 4 offers in non-sorted order:
    // Offer 1: Fresh, €1.69
    // Offer 2: Stale (>72h), €0.92 (must come FIRST because it is cheapest!)
    // Offer 3: Fresh, €1.08
    // Offer 4: Stale (>72h), €1.06
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', ?, 'https://example.com/deal', 1, 0, ?, ?, ?, ?)
    `).run(randomUUID(), game.id, m1.id, 1.69, freshIso, freshIso, freshIso, freshIso);

    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', ?, 'https://example.com/deal', 1, 0, ?, ?, ?, ?)
    `).run(randomUUID(), game.id, m2.id, 0.92, staleIso, staleIso, staleIso, staleIso);

    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', ?, 'https://example.com/deal', 1, 0, ?, ?, ?, ?)
    `).run(randomUUID(), game.id, m3.id, 1.08, freshIso, freshIso, freshIso, freshIso);

    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', ?, 'https://example.com/deal', 1, 0, ?, ?, ?, ?)
    `).run(randomUUID(), game.id, m4.id, 1.06, staleIso, staleIso, staleIso, staleIso);

    const offers = offerRepo.getOffersForGame(game.id);
    expect(offers).toHaveLength(4);

    // Expected order: €0.92 (Stale) -> €1.06 (Stale) -> €1.08 (Fresh) -> €1.69 (Fresh)
    expect(offers.map(o => o.priceEur)).toEqual([0.92, 1.06, 1.08, 1.69]);

    // Check that isFresh accurately flags stale vs fresh without affecting order
    expect(offers[0].isFresh).toBe(false); // €0.92 is stale
    expect(offers[1].isFresh).toBe(false); // €1.06 is stale
    expect(offers[2].isFresh).toBe(true);  // €1.08 is fresh
    expect(offers[3].isFresh).toBe(true);  // €1.69 is fresh
  });

  it('invalidates expired offers older than OFFER_MAX_AGE_DAYS (14 days)', () => {
    gameRepo.upsert({ steamAppId: 9002, title: 'TTL Test Game', basePriceEur: 19.99 });
    const game = gameRepo.getBySteamAppId(9002)!;
    const merchant1 = merchantRepo.getOrCreate('store_ttl_1', 'Store TTL 1', true);
    const merchant2 = merchantRepo.getOrCreate('store_ttl_2', 'Store TTL 2', true);

    const now = new Date();
    const freshIso = now.toISOString();
    const deadIso = new Date(now.getTime() - 20 * 24 * 3600 * 1000).toISOString(); // 20 days old (>14d)

    const freshId = randomUUID();
    const deadId = randomUUID();

    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 9.99, 'https://example.com/deal', 1, 0, ?, ?, ?, ?)
    `).run(freshId, game.id, merchant1.id, freshIso, freshIso, freshIso, freshIso);

    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 2.99, 'https://example.com/deal', 1, 1, ?, ?, ?, ?)
    `).run(deadId, game.id, merchant2.id, deadIso, deadIso, deadIso, deadIso);

    // Both are initially valid in DB
    expect(offerRepo.getById(freshId)!.isValid).toBe(true);
    expect(offerRepo.getById(deadId)!.isValid).toBe(true);

    // Run invalidation
    const res = offerRepo.invalidateExpiredOffers(14);
    expect(res.invalidatedCount).toBe(1);

    // Dead offer is now invalid and stripped of is_best_deal
    const updatedDead = offerRepo.getById(deadId)!;
    expect(updatedDead.isValid).toBe(false);
    expect(updatedDead.isBestDeal).toBe(false);

    // Fresh offer is untouched
    const updatedFresh = offerRepo.getById(freshId)!;
    expect(updatedFresh.isValid).toBe(true);
  });
});
