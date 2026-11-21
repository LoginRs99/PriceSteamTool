import { describe, it, expect, beforeEach } from 'vitest';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  getDb 
} from '../../src/server/db/index.js';
import { 
  calculateDealScore, 
  calculateShoppingScore,
  calculateCredibleSavings 
} from '../../src/server/domain/dealScore.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM anomalies;
    DELETE FROM offers;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM merchants;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}

describe('Top Best Deals Intelligence & Multi-Dimensional Shopping Score', () => {
  describe('calculateShoppingScore unit logic', () => {
    it('evaluates official and keyshop stores on 100% equal terms (pure price opportunity)', () => {
      // Identical game & deal score (80)
      const officialScore = calculateShoppingScore({
        dealScore: 80,
        isOfficial: true,
        currentPriceEur: 19.99,
        basePriceEur: 59.99,
        confidenceScore: 80
      });

      const keyshopScore = calculateShoppingScore({
        dealScore: 80,
        isOfficial: false,
        currentPriceEur: 19.99,
        basePriceEur: 59.99,
        confidenceScore: 80
      });

      // No artificial store bias: both score equally
      expect(officialScore).toBe(keyshopScore);
    });

    it('does not bias ranking by external review scores or ratings', () => {
      const baseInput = {
        dealScore: 75,
        isOfficial: true,
        currentPriceEur: 14.99,
        basePriceEur: 49.99,
        confidenceScore: 80
      };

      const unratedScore = calculateShoppingScore({ ...baseInput });
      const acclaimedScore = calculateShoppingScore({ ...baseInput, metacriticScore: 92 });
      const greatScore = calculateShoppingScore({ ...baseInput, steamReviewPercent: 88 });
      const mediocreScore = calculateShoppingScore({ ...baseInput, steamReviewPercent: 45 });

      // User already wants all wishlist games: pure price ranking without review score bias
      expect(acclaimedScore).toBe(unratedScore);
      expect(greatScore).toBe(unratedScore);
      expect(mediocreScore).toBe(unratedScore);
    });

    it('rewards high absolute monetary savings with logarithmic utility bonus', () => {
      // 50% off a €70 game saves €35
      const bigGameScore = calculateShoppingScore({
        dealScore: 70,
        isOfficial: true,
        currentPriceEur: 35.00,
        basePriceEur: 70.00,
        confidenceScore: 80
      });

      // 50% off a €2 game saves €1
      const smallGameScore = calculateShoppingScore({
        dealScore: 70,
        isOfficial: true,
        currentPriceEur: 1.00,
        basePriceEur: 2.00,
        confidenceScore: 80
      });

      // Large absolute savings provide greater consumer purchasing utility
      expect(bigGameScore).toBeGreaterThan(smallGameScore);
    });

    it('awards market competitiveness edge bonus when retailer significantly undercuts competition', () => {
      const standardDeal = calculateShoppingScore({
        dealScore: 75,
        currentPriceEur: 10.00,
        basePriceEur: 40.00,
        confidenceScore: 80
      });

      const competitiveDeal = calculateShoppingScore({
        dealScore: 75,
        currentPriceEur: 10.00,
        basePriceEur: 40.00,
        competingPriceEur: 15.00, // 33% cheaper than competing store
        confidenceScore: 80
      });

      expect(competitiveDeal).toBeGreaterThan(standardDeal);
    });

    it('awards bonus for sitting at or near historical all-time low', () => {
      const atRecordLow = calculateShoppingScore({
        dealScore: 75,
        currentPriceEur: 9.99,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        confidenceScore: 80
      });

      const aboveRecordLow = calculateShoppingScore({
        dealScore: 75,
        currentPriceEur: 19.99,
        basePriceEur: 49.99,
        historicalLowEur: 10.00,
        confidenceScore: 80
      });

      expect(atRecordLow).toBeGreaterThan(aboveRecordLow);
    });

    it('returns 0 for non-deals or invalid prices and caps at 100', () => {
      expect(calculateShoppingScore({ dealScore: 0, currentPriceEur: 10, isOfficial: true })).toBe(0);
      expect(calculateShoppingScore({ dealScore: 80, currentPriceEur: 0, isOfficial: true })).toBe(0);

      const maxScore = calculateShoppingScore({
        dealScore: 98,
        isOfficial: true,
        currentPriceEur: 5.00,
        basePriceEur: 70.00,
        confidenceScore: 100
      });
      expect(maxScore).toBeLessThanOrEqual(100);
      expect(maxScore).toBeGreaterThanOrEqual(95);
    });

    it('calculateCredibleSavings bounds reference price against median to eliminate fake MSRP savings', () => {
      // Fake/inflated MSRP: €80 MSRP on a game that regularly sells for €10 median
      // Buying at €10 should NOT yield €70 savings! Reference price bounded to €10 * 1.6 = €16.00
      const inflatedSavings = calculateCredibleSavings(10.00, 80.00, 10.00);
      expect(inflatedSavings).toBe(6.00); // 16.00 - 10.00 = 6.00

      // Authentic AAA game: €60 MSRP with €50 median, on sale for €20
      // Reference price is €60 (since 60 <= 50 * 1.6 = 80)
      const authenticSavings = calculateCredibleSavings(20.00, 60.00, 50.00);
      expect(authenticSavings).toBe(40.00); // 60.00 - 20.00 = 40.00

      // Missing or invalid prices produce 0 savings (never artificial savings)
      expect(calculateCredibleSavings(undefined, 60.00, 50.00)).toBe(0);
      expect(calculateCredibleSavings(20.00, undefined, undefined)).toBe(0);
      expect(calculateCredibleSavings(20.00, 15.00, undefined)).toBe(0); // Price higher than reference
    });
  });

  describe('Dual ATL isolation in calculateDealScore', () => {
    it('evaluates official retailer deal against officialHistoricalLowEur rather than keyshop dump', () => {
      // An official store sells the game for €10.00 (which is its all-time record on official stores)
      // but an unverified keyshop previously listed it at €3.00.
      const evaluatedWithOfficialAtl = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 40.00,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 3.00,
        historicalLowEur: 3.00,
        officialHistoricalLowEur: 10.00,
        isOfficialStore: true,
        sampleCount: 15
      });

      const evaluatedWithoutOfficialAtl = calculateDealScore({
        priceEur: 10.00,
        basePriceEur: 40.00,
        typicalSaleMedianEur: 20.00,
        allTimeLowEur: 3.00,
        historicalLowEur: 3.00,
        officialHistoricalLowEur: undefined,
        isOfficialStore: true,
        sampleCount: 15
      });

      // With officialHistoricalLowEur passed, it recognizes the record official deal
      expect(evaluatedWithOfficialAtl.score).toBeGreaterThan(evaluatedWithoutOfficialAtl.score);
      expect(['MATCHES_RECORD_LOW', 'INSTANT_BUY']).toContain(evaluatedWithOfficialAtl.verdict);
    });
  });

  describe('gameRepo.getBestDeals smart ranking and discovery', () => {
    beforeEach(() => {
      resetDatabase();
    });

    it('competes stores on 100% equal terms and exposes alternative offer transparently', () => {
      const profile = profileRepo.create('Deal Hunter', '76561198000011111');
      const gmg = merchantRepo.getOrCreate('greenmangaming', 'Green Man Gaming', true);
      const eneba = merchantRepo.getOrCreate('eneba', 'Eneba Marketplace', false);

      const game = gameRepo.upsert({
        steamAppId: 10001,
        title: 'Star Wars Epic Adventure',
        slug: 'star-wars-epic',
        basePriceEur: 49.99
      });
      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 10001, title: 'Star Wars Epic Adventure', priority: 1 }
      ]);

      // Official store has it for €3.78
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        priceEur: 3.78,
        originalPriceEur: 49.99,
        discountPercent: 92,
        sourceCode: 'itad',
        dealUrl: 'https://gmg.com/star-wars',
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        isValid: true
      });

      // Keyshop has it for €3.74 (cheaper)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: eneba.id,
        priceEur: 3.74,
        originalPriceEur: 49.99,
        discountPercent: 92,
        sourceCode: 'allkeyshop',
        dealUrl: 'https://eneba.com/star-wars',
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        isValid: true
      });

      const deals = gameRepo.getBestDeals(profile.id, 10);
      expect(deals.length).toBe(1);

      const chosen = deals[0];
      // On 100% equal terms, cheaper price wins:
      expect(chosen.bestMerchantName).toBe('Eneba Marketplace');
      expect(chosen.bestMerchantIsOfficial).toBe(false);
      expect(chosen.bestPriceEur).toBe(3.74);

      // Transparent alternative offer info is provided
      expect(chosen.alternativeOfferPriceEur).toBe(3.78);
      expect(chosen.alternativeMerchantName).toBe('Green Man Gaming');
      expect(chosen.alternativeMerchantIsOfficial).toBe(true);
    });

    it('correctly sorts deals by credible cash savings rather than blindly trusting inflated MSRP', () => {
      const profile = profileRepo.create('Savings Tester', '76561198000012345');
      const steam = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Game A (Authentic AAA): €60 MSRP, €50 median, on sale for €20 -> saves €40 cash
      const gA = gameRepo.upsert({ steamAppId: 40001, title: 'AAA Blockbuster', slug: 'aaa-blockbuster', basePriceEur: 60.00 });
      // Game B (Inflated MSRP): Claimed €80 MSRP, but €10 median, on sale for €10 -> raw MSRP claims €70, but credible reference is €16 -> saves €6
      const gB = gameRepo.upsert({ steamAppId: 40002, title: 'Inflated Price Game', slug: 'inflated-game', basePriceEur: 80.00 });
      
      const db = getDb();
      db.prepare('UPDATE games SET typical_sale_median_eur = 10.00 WHERE id = ?').run(gB.id);
      db.prepare('UPDATE games SET typical_sale_median_eur = 50.00 WHERE id = ?').run(gA.id);

      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 40001, title: 'AAA Blockbuster', priority: 1 },
        { steamAppId: 40002, title: 'Inflated Price Game', priority: 2 }
      ]);

      offerRepo.upsertOffer({ gameId: gA.id, merchantId: steam.id, priceEur: 20.00, originalPriceEur: 60.00, discountPercent: 67, productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', sourceCode: 'steam', dealUrl: 'urlA', isValid: true });
      offerRepo.upsertOffer({ gameId: gB.id, merchantId: steam.id, priceEur: 10.00, originalPriceEur: 80.00, discountPercent: 88, productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', sourceCode: 'steam', dealUrl: 'urlB', isValid: true });

      const savingsDeals = gameRepo.getBestDeals(profile.id, 10, { sort: 'savings' });
      // AAA Blockbuster saves €40 in real cash; Inflated Price Game only saves €6 against its credible reference
      expect(savingsDeals[0].title).toBe('AAA Blockbuster');
      expect(savingsDeals[1].title).toBe('Inflated Price Game');
    });

    it('isolates official store historical low from keyshop dumps and protects non-standard editions', () => {
      const profile = profileRepo.create('ATL Isolation Tester', '76561198000055555');
      const steam = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Game with official historical low = €9.08, but legacy keyshop dump = €3.28
      const game = gameRepo.upsert({
        steamAppId: 50001,
        title: 'Call of Duty Classic',
        slug: 'cod-classic',
        basePriceEur: 19.99
      });
      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 50001, title: 'Call of Duty Classic', priority: 1 }
      ]);

      // Set official historical low = €9.08, overall historical low = €3.28
      gameRepo.updateOfficialHistoricalLow(game.id, 9.08, '2026-01-01', 'Steam Store');
      gameRepo.updateHistoricalLow(game.id, 3.28, '2025-01-01', 'keyshop_dump');

      // Active offer on Steam Store at €9.10 (within 2% of official record low €9.08!)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: steam.id,
        priceEur: 9.10,
        originalPriceEur: 19.99,
        discountPercent: 54,
        sourceCode: 'steam',
        dealUrl: 'https://store.steampowered.com/app/50001',
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        editionKey: 'standard',
        activationPlatform: 'steam',
        isValid: true
      });

      const deals = gameRepo.getBestDeals(profile.id, 10);
      expect(deals.length).toBe(1);
      const chosen = deals[0];
      expect(chosen.bestMerchantIsOfficial).toBe(true);
      expect(chosen.officialHistoricalLowEur).toBe(9.08);
      expect(chosen.historicalLowEur).toBe(3.28);

      // Verify that calculateShoppingScore with the isolated official historical low receives the +3 bonus
      const withOfficialAtl = calculateShoppingScore({
        dealScore: 70,
        currentPriceEur: 9.10,
        basePriceEur: 19.99,
        historicalLowEur: 9.08 // official historical low
      });

      const withKeyshopDumpAtl = calculateShoppingScore({
        dealScore: 70,
        currentPriceEur: 9.10,
        basePriceEur: 19.99,
        historicalLowEur: 3.28 // keyshop dump
      });

      // Against official historical low (€9.08), €9.10 is within 2% -> +3 bonus awarded.
      // Against keyshop dump (€3.28), 0 bonus is awarded.
      expect(withOfficialAtl - withKeyshopDumpAtl).toBe(3);
    });

    it('filters accurately by merchantType: official vs keyshop', () => {
      const profile = profileRepo.create('Store Filter Tester', '76561198000022222');
      const steam = merchantRepo.getOrCreate('steam', 'Steam Store', true);
      const gamivo = merchantRepo.getOrCreate('gamivo', 'GAMIVO', false);

      // Game 1: only on Steam (official)
      const g1 = gameRepo.upsert({
        steamAppId: 20001,
        title: 'Steam Exclusive RPG',
        slug: 'steam-rpg',
        basePriceEur: 29.99
      });
      // Game 2: only on Gamivo (keyshop)
      const g2 = gameRepo.upsert({
        steamAppId: 20002,
        title: 'Keyshop Exclusive Shooter',
        slug: 'keyshop-shooter',
        basePriceEur: 39.99
      });

      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 20001, title: 'Steam Exclusive RPG', priority: 1 },
        { steamAppId: 20002, title: 'Keyshop Exclusive Shooter', priority: 2 }
      ]);

      offerRepo.upsertOffer({
        gameId: g1.id,
        merchantId: steam.id,
        priceEur: 9.99,
        originalPriceEur: 29.99,
        discountPercent: 67,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        sourceCode: 'steam',
        dealUrl: 'https://store.steampowered.com/app/20001',
        isValid: true
      });

      offerRepo.upsertOffer({
        gameId: g2.id,
        merchantId: gamivo.id,
        priceEur: 4.99,
        originalPriceEur: 39.99,
        discountPercent: 87,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        sourceCode: 'allkeyshop',
        dealUrl: 'https://gamivo.com/shooter',
        isValid: true
      });

      // Filter: Official only
      const officialDeals = gameRepo.getBestDeals(profile.id, 10, { merchantType: 'official' });
      expect(officialDeals.length).toBe(1);
      expect(officialDeals[0].title).toBe('Steam Exclusive RPG');

      // Filter: Keyshop only
      const keyshopDeals = gameRepo.getBestDeals(profile.id, 10, { merchantType: 'keyshop' });
      expect(keyshopDeals.length).toBe(1);
      expect(keyshopDeals[0].title).toBe('Keyshop Exclusive Shooter');

      // All stores
      const allDeals = gameRepo.getBestDeals(profile.id, 10, { merchantType: 'all' });
      expect(allDeals.length).toBe(2);
    });

    it('supports maxPrice filter, title search, and pagination metadata', () => {
      const profile = profileRepo.create('Search & Paging Tester', '76561198000033333');
      const steam = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Create 3 games at €3.99, €8.99, €19.99
      const g1 = gameRepo.upsert({ steamAppId: 30001, title: 'Budget Indie Quest', slug: 'budget-indie', basePriceEur: 14.99 });
      const g2 = gameRepo.upsert({ steamAppId: 30002, title: 'Mid-Tier Strategy Quest', slug: 'midtier-strategy', basePriceEur: 29.99 });
      const g3 = gameRepo.upsert({ steamAppId: 30003, title: 'Premium AAA Action', slug: 'premium-aaa', basePriceEur: 59.99 });

      gameRepo.syncWishlistEntries(profile.id, [
        { steamAppId: 30001, title: 'Budget Indie Quest', priority: 1 },
        { steamAppId: 30002, title: 'Mid-Tier Strategy Quest', priority: 2 },
        { steamAppId: 30003, title: 'Premium AAA Action', priority: 3 }
      ]);

      offerRepo.upsertOffer({ gameId: g1.id, merchantId: steam.id, priceEur: 3.99, originalPriceEur: 14.99, discountPercent: 73, productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', sourceCode: 'steam', dealUrl: 'url1', isValid: true });
      offerRepo.upsertOffer({ gameId: g2.id, merchantId: steam.id, priceEur: 8.99, originalPriceEur: 29.99, discountPercent: 70, productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', sourceCode: 'steam', dealUrl: 'url2', isValid: true });
      offerRepo.upsertOffer({ gameId: g3.id, merchantId: steam.id, priceEur: 19.99, originalPriceEur: 59.99, discountPercent: 66, productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', sourceCode: 'steam', dealUrl: 'url3', isValid: true });

      // Max price filter < €5
      const under5 = gameRepo.getBestDeals(profile.id, 10, { maxPrice: 5 });
      expect(under5.length).toBe(1);
      expect(under5[0].title).toBe('Budget Indie Quest');

      // Title search "Quest"
      const questDeals = gameRepo.getBestDeals(profile.id, 10, { search: 'Quest' });
      expect(questDeals.length).toBe(2);

      // Paginated result object
      const pagedResult: any = gameRepo.getBestDeals(profile.id, 2, { asResultObject: true, page: 1 });
      expect(pagedResult.total).toBe(3);
      expect(pagedResult.page).toBe(1);
      expect(pagedResult.totalPages).toBe(2);
      expect(pagedResult.deals.length).toBe(2);
    });
  });
});
