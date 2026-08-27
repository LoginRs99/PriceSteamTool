import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, prepareStmt } from '../../src/server/db/core.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { offerRepo, isCompatiblePeerOffer } from '../../src/server/db/repositories/offer.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { randomUUID } from 'crypto';

describe('Canonical Freshness & Best Deal Selection Suite', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM profiles;
      DELETE FROM games;
      DELETE FROM merchants;
    `);
  });


  it('Case A: Fresh valid offer beats stale valid offer even if stale has lower price', () => {
    const game = gameRepo.upsert({ steamAppId: 1001, title: 'Case A Game', basePriceEur: 20.0 });
    const merchantA = merchantRepo.getOrCreate('store_a', 'Store A', true);
    const merchantB = merchantRepo.getOrCreate('store_b', 'Store B', true);

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Insert Offer A: €5.00, stale (5 days ago)
    const offerAId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 5.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-a.com', ?, ?)
    `).run(offerAId, game.id, merchantA.id, fiveDaysAgo, fiveDaysAgo, fiveDaysAgo, fiveDaysAgo);

    // Insert Offer B: €8.00, fresh (5 minutes ago)
    const offerBId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 8.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-b.com', ?, ?)
    `).run(offerBId, game.id, merchantB.id, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo);

    // Recompute best deal
    offerRepo.recomputeBestDealForGame(game.id);

    const recomputedGame = gameRepo.getById(game.id)!;
    expect(recomputedGame.bestOfferId).toBe(offerBId);
    expect(recomputedGame.bestPriceEur).toBe(8.00);
    expect(recomputedGame.bestIsFresh).toBe(true);

    const offers = offerRepo.getOffersForGame(game.id);
    expect(offers.length).toBe(2);
    // Fresh €8.00 should be the best deal
    const bestOffer = offers.find(o => o.isBestDeal);
    expect(bestOffer).toBeDefined();
    expect(bestOffer?.id).toBe(offerBId);
    expect(bestOffer?.priceEur).toBe(8.00);
    expect(bestOffer?.isFresh).toBe(true);

    // Stale €5.00 is preserved in offers/history but NOT marked as best deal
    const staleOffer = offers.find(o => o.id === offerAId);
    expect(staleOffer).toBeDefined();
    expect(staleOffer?.isBestDeal).toBe(false);
    expect(staleOffer?.isFresh).toBe(false);
  });

  it('Case B: Fresh cheap offer wins against fresh expensive offer', () => {
    const game = gameRepo.upsert({ steamAppId: 1002, title: 'Case B Game', basePriceEur: 20.0 });
    const merchantA = merchantRepo.getOrCreate('store_a', 'Store A', true);
    const merchantB = merchantRepo.getOrCreate('store_b', 'Store B', true);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const offerAId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 5.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-a.com', ?, ?)
    `).run(offerAId, game.id, merchantA.id, tenMinutesAgo, tenMinutesAgo, tenMinutesAgo, tenMinutesAgo);

    const offerBId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 8.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-b.com', ?, ?)
    `).run(offerBId, game.id, merchantB.id, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo);

    offerRepo.recomputeBestDealForGame(game.id);

    const recomputedGame = gameRepo.getById(game.id)!;
    expect(recomputedGame.bestOfferId).toBe(offerAId);
    expect(recomputedGame.bestPriceEur).toBe(5.00);
    expect(recomputedGame.bestIsFresh).toBe(true);
  });

  it('Case C: Fresh safe offer beats fresh HIGH-risk / anomalous offer', () => {
    const game = gameRepo.upsert({ steamAppId: 1003, title: 'Case C Game', basePriceEur: 60.0 });
    const merchantA = merchantRepo.getOrCreate('shady_keys', 'Shady Keys', false);
    const merchantB = merchantRepo.getOrCreate('legit_store', 'Legit Store', true);

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Offer A: €5.00, fresh, HIGH risk / anomaly
    const offerAId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 5.00, 1, 1, 'HIGH', 0, ?, ?, 'https://shady.com', ?, ?)
    `).run(offerAId, game.id, merchantA.id, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo);

    // Offer B: €6.00, fresh, SAFE
    const offerBId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 6.00, 1, 0, 'SAFE', 0, ?, ?, 'https://legit.com', ?, ?)
    `).run(offerBId, game.id, merchantB.id, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo);

    offerRepo.recomputeBestDealForGame(game.id);

    const recomputedGame = gameRepo.getById(game.id)!;
    expect(recomputedGame.bestOfferId).toBe(offerBId);
    expect(recomputedGame.bestPriceEur).toBe(6.00);
    expect(recomputedGame.bestRiskLevel).toBe('SAFE');
    expect(recomputedGame.bestIsFresh).toBe(true);
  });

  it('Case D: All offers stale selects cheapest valid fallback but explicitly marks isFresh: false', () => {
    const game = gameRepo.upsert({ steamAppId: 1004, title: 'Case D Game', basePriceEur: 20.0 });
    const merchantA = merchantRepo.getOrCreate('store_a', 'Store A', true);
    const merchantB = merchantRepo.getOrCreate('store_b', 'Store B', true);

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

    const offerAId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 5.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-a.com', ?, ?)
    `).run(offerAId, game.id, merchantA.id, fiveDaysAgo, fiveDaysAgo, fiveDaysAgo, fiveDaysAgo);

    const offerBId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_anomaly, risk_level, is_best_deal, last_observed_at, fetched_at, deal_url, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 8.00, 1, 0, 'SAFE', 0, ?, ?, 'https://store-b.com', ?, ?)
    `).run(offerBId, game.id, merchantB.id, sixDaysAgo, sixDaysAgo, sixDaysAgo, sixDaysAgo);

    offerRepo.recomputeBestDealForGame(game.id);

    const recomputedGame = gameRepo.getById(game.id)!;
    expect(recomputedGame.bestOfferId).toBe(offerAId);
    expect(recomputedGame.bestPriceEur).toBe(5.00);
    // Explicit stale indicator: bestIsFresh MUST be false
    expect(recomputedGame.bestIsFresh).toBe(false);
    expect(recomputedGame.bestLastObservedAt).toBe(fiveDaysAgo);

    const offers = offerRepo.getOffersForGame(game.id);
    expect(offers.length).toBe(2);
    const bestFallback = offers.find(o => o.isBestDeal);
    expect(bestFallback?.id).toBe(offerAId);
    expect(bestFallback?.isFresh).toBe(false);
  });

  it('Stale offers are strictly excluded from participating in live peer market comparisons', () => {
    const now = Date.now();
    const staleTime = new Date(now - 80 * 60 * 60 * 1000).toISOString(); // 80h ago (>72h)
    const freshTime = new Date(now - 2 * 60 * 60 * 1000).toISOString();  // 2h ago (<=72h)

    const target = { productType: 'KEY', regionType: 'GLOBAL' };

    // Fresh valid peer is compatible
    expect(isCompatiblePeerOffer(target, {
      productType: 'KEY',
      regionType: 'GLOBAL',
      isValid: true,
      isAnomaly: false,
      riskLevel: 'SAFE',
      lastObservedAt: freshTime
    }, now)).toBe(true);

    // Stale peer (> 72h) is strictly excluded
    expect(isCompatiblePeerOffer(target, {
      productType: 'KEY',
      regionType: 'GLOBAL',
      isValid: true,
      isAnomaly: false,
      riskLevel: 'SAFE',
      lastObservedAt: staleTime
    }, now)).toBe(false);
  });
});
