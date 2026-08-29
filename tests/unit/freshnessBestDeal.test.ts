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

  it('Write-time and read-time Deal Score, sampleCount-derived fields, and isProvisional flag are IDENTICAL', () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const game = gameRepo.upsert({
      steamAppId: 9999,
      title: 'Consistency Test Game',
      basePriceEur: 50.0,
      historicalLowEur: 30.0,
      historicalLowDate: fiveDaysAgo,
      historicalLowSource: 'steam'
    });
    const merchant = merchantRepo.getOrCreate('steam_store', 'Steam', true);

    // Insert historical price observations so price_history has established depth (sampleCount >= 2)
    prepareStmt(`
      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, price_event, is_anomaly, risk_level, recorded_at)
      VALUES (?, ?, ?, 'steam', 40.0, 20, 'STANDARD_SALE', 0, 'SAFE', ?)
    `).run(randomUUID(), game.id, merchant.id, tenDaysAgo);

    prepareStmt(`
      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, price_event, is_anomaly, risk_level, recorded_at)
      VALUES (?, ?, ?, 'steam', 30.0, 40, 'STANDARD_SALE', 0, 'SAFE', ?)
    `).run(randomUUID(), game.id, merchant.id, fiveDaysAgo);

    // Upsert a new offer via offerRepo.upsertOffer (which executes the write-time dealCalc calculation)
    const offer = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      sourceCode: 'steam',
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 20.0,
      originalPriceEur: 50.0,
      dealUrl: 'https://store.steampowered.com/app/9999'
    });

    // 1. Fetch write-time deal_score recorded in price_history for this new observation
    const latestHistoryRow = prepareStmt(`
      SELECT * FROM price_history WHERE game_id = ? ORDER BY recorded_at DESC LIMIT 1
    `).get(game.id) as any;

    expect(latestHistoryRow).toBeDefined();
    expect(latestHistoryRow.price_eur).toBe(20.0);
    const writeTimeScore = latestHistoryRow.deal_score;
    expect(writeTimeScore).toBeDefined();

    // 2. Fetch read-time offer via getById
    const readOffer = offerRepo.getById(offer.id)!;
    expect(readOffer).toBeDefined();
    expect(readOffer.dealScore).toBe(writeTimeScore);

    // 3. Fetch read-time offer list via getOffersForGame
    const offerList = offerRepo.getOffersForGame(game.id);
    expect(offerList.length).toBeGreaterThan(0);
    const bestOfferInList = offerList.find(o => o.id === offer.id)!;
    expect(bestOfferInList.dealScore).toBe(writeTimeScore);
    expect(bestOfferInList.isProvisional).toBe(readOffer.isProvisional);
    expect(bestOfferInList.confidenceScore).toBe(readOffer.confidenceScore);

    // 4. Fetch read-time game via gameRepo.getById
    const readGame = gameRepo.getById(game.id)!;
    expect(readGame).toBeDefined();
    expect(readGame.bestDealScore).toBe(writeTimeScore);
    expect(readGame.bestIsProvisional).toBe(readOffer.isProvisional);
    expect(readGame.bestConfidenceScore).toBe(readOffer.confidenceScore);
    expect(readGame.typicalSaleSampleCount).toBeDefined();
    expect(readGame.typicalSaleSampleCount).toBeGreaterThanOrEqual(3);
  });

  describe('Conservative Hierarchical Region Compatibility', () => {
    it('GLOBAL vs GLOBAL: compatible', () => {
      const target = { productType: 'STEAM_KEY', regionType: 'GLOBAL' };
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true })).toBe(true);
    });

    it('GLOBAL vs EU: compatible when target is EU (EU buyer accepts GLOBAL key), but incompatible when target is GLOBAL', () => {
      // EU target accepts GLOBAL peer (GLOBAL key activates everywhere, including EU)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'EU' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true })).toBe(true);
      // GLOBAL target rejects EU peer (EU key cannot prove GLOBAL market price)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true })).toBe(false);
    });

    it('GLOBAL vs HU: compatible when target is HU (HU buyer accepts GLOBAL key), but incompatible when target is GLOBAL', () => {
      // HU target accepts GLOBAL peer
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'HU' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true })).toBe(true);
      // GLOBAL target rejects HU peer (HU-only key cannot prove GLOBAL market price)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true })).toBe(false);
    });

    it('EU vs HU: compatible when target is HU (HU buyer accepts EU key), but incompatible when target is EU (EU key cannot be substituted by HU-only key)', () => {
      // HU target accepts EU peer (EU key activates in Hungary)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'HU' }, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true })).toBe(true);
      // EU target rejects HU peer (HU-locked key cannot be activated outside Hungary in rest of EU)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'EU' }, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true })).toBe(false);
    });

    it('HU vs HU: compatible', () => {
      const target = { productType: 'STEAM_KEY', regionType: 'HU' };
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true })).toBe(true);
    });

    it('EU vs EU: compatible', () => {
      const target = { productType: 'STEAM_KEY', regionType: 'EU' };
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true })).toBe(true);
    });

    it('Demonstrating an HU-only low price does NOT get used as a compatible peer for a GLOBAL-region offer during evaluation', () => {
      const game = gameRepo.upsert({ steamAppId: 8888, title: 'Region Isolation Test Game', basePriceEur: 60.0 });
      const merchantA = merchantRepo.getOrCreate('merchant_global', 'Global Store', true);
      const merchantB = merchantRepo.getOrCreate('merchant_hu', 'HU Local Store', false);

      // Merchant B has an HU-only localized cheap key for €5.00
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchantB.id,
        sourceCode: 'allkeyshop',
        productType: 'STEAM_KEY',
        regionType: 'HU',
        priceEur: 5.0,
        dealUrl: 'https://hu-store.com'
      });

      // Merchant A lists a GLOBAL key for €40.00
      // When upsertOffer evaluates Merchant A's offer, Merchant B's HU offer must NOT be treated as a compatible peer
      const globalOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchantA.id,
        sourceCode: 'steam',
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 40.0,
        dealUrl: 'https://global-store.com'
      });

      // The global offer should remain valid and not be flagged with an anomaly from the HU-locked price
      expect(globalOffer).toBeDefined();
      expect(globalOffer.isAnomaly).toBe(false);
      expect(globalOffer.riskLevel).not.toBe('HIGH');
    });
  });
});
