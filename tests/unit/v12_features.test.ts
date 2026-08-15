import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { 
  getDb, 
  closeDb,
  profileRepo, 
  gameRepo, 
  offerRepo, 
  merchantRepo
} from '../../src/server/db/index.js';

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

describe('v1.2 Deal Score, Statistics & Discovery Filter Tests', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('computes accurate WishlistStatistics across active wishlist entries', () => {
    const profile = profileRepo.create('Test User', '76561198000000001');
    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const keyshop = merchantRepo.getOrCreate('keyshop_a', 'Keyshop Store', false);

    // Game 1: 75% sale with previous historical low anchor (Cyberpunk 2077) -> NEW_HISTORICAL_LOW
    const g1 = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    gameRepo.updateHistoricalLow(g1.id, 29.99, '2025-01-01', 'steam');
    gameRepo.syncWishlistEntries(profile.id, [{ steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 }]);
    
    // Multi-source observation to give full consensus & confidence
    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 14.99,
      originalPriceEur: 59.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1091500'
    });
    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 14.99,
      originalPriceEur: 59.99,
      sourceCode: 'itad',
      dealUrl: 'https://store.steampowered.com/app/1091500'
    });

    // Game 2: 20% sale, MINOR_DROP
    const g2 = gameRepo.upsert({
      steamAppId: 1245620,
      title: 'Elden Ring',
      basePriceEur: 59.99
    });
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1245620, title: 'Elden Ring', priority: 2 }
    ]);
    offerRepo.upsertOffer({
      gameId: g2.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 47.99,
      originalPriceEur: 59.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1245620'
    });

    // Game 3: Full price, 0% sale
    const g3 = gameRepo.upsert({
      steamAppId: 570,
      title: 'Dota 2 Special Pack',
      basePriceEur: 29.99
    });
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1245620, title: 'Elden Ring', priority: 2 },
      { steamAppId: 570, title: 'Dota 2 Special Pack', priority: 3 }
    ]);
    offerRepo.upsertOffer({
      gameId: g3.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      originalPriceEur: 29.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/570'
    });

    // Game 4: Has a HIGH risk pricing error offer (e.g. 0.49€ on 60€)
    const g4 = gameRepo.upsert({
      steamAppId: 271590,
      title: 'Grand Theft Auto V',
      basePriceEur: 59.99
    });
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1245620, title: 'Elden Ring', priority: 2 },
      { steamAppId: 570, title: 'Dota 2 Special Pack', priority: 3 },
      { steamAppId: 271590, title: 'Grand Theft Auto V', priority: 4 }
    ]);
    offerRepo.upsertOffer({
      gameId: g4.id,
      merchantId: keyshop.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      originalPriceEur: 59.99,
      sourceCode: 'cheapshark',
      dealUrl: 'https://keyshop.example/gta5'
    });

    const stats = gameRepo.getWishlistStatistics(profile.id);
    expect(stats.totalGames).toBe(4);
    expect(stats.gamesOnSale).toBe(3); // g1 (75%), g2 (20%), g4 (99%)
    expect(stats.gamesAtHistoricalLow).toBe(1); // g1 is NEW_HISTORICAL_LOW
    expect(stats.gamesWithHighRiskOffers).toBe(1); // g4 has HIGH risk offer
    expect(stats.averageDiscountPercent).toBeGreaterThan(0);
  });

  it('orders Best Deals by computed Deal Score and excludes HIGH risk / anomalies', () => {
    const profile = profileRepo.create('Test User', '76561198000000002');
    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const keyshop = merchantRepo.getOrCreate('shady', 'Untrusted Shop', false);

    // Legitimate 75% ATL deal -> Deal Score should be ~97
    const g1 = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    gameRepo.updateHistoricalLow(g1.id, 29.99, '2025-01-01', 'steam');
    gameRepo.syncWishlistEntries(profile.id, [{ steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 }]);
    
    // Verified across 2 sources
    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 14.99,
      originalPriceEur: 59.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1091500'
    });
    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 14.99,
      originalPriceEur: 59.99,
      sourceCode: 'itad',
      dealUrl: 'https://store.steampowered.com/app/1091500'
    });

    // 20% sale -> Deal Score should be ~36
    const g2 = gameRepo.upsert({
      steamAppId: 1245620,
      title: 'Elden Ring',
      basePriceEur: 59.99
    });
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1245620, title: 'Elden Ring', priority: 2 }
    ]);
    offerRepo.upsertOffer({
      gameId: g2.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 47.99,
      originalPriceEur: 59.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1245620'
    });

    // HIGH risk anomaly -> 0.49€ on 60€ game
    const g3 = gameRepo.upsert({
      steamAppId: 271590,
      title: 'GTA V Glitch',
      basePriceEur: 59.99
    });
    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 1245620, title: 'Elden Ring', priority: 2 },
      { steamAppId: 271590, title: 'GTA V Glitch', priority: 3 }
    ]);
    offerRepo.upsertOffer({
      gameId: g3.id,
      merchantId: keyshop.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      originalPriceEur: 59.99,
      sourceCode: 'cheapshark',
      dealUrl: 'https://shady.example/gta5'
    });

    const bestDeals = gameRepo.getBestDeals(profile.id, 10);
    
    // HIGH risk g3 must be excluded from normal Best Deals
    expect(bestDeals.some(d => d.id === g3.id)).toBe(false);

    // g1 (Score ~97) must come before g2 (Score ~36)
    expect(bestDeals.length).toBe(2);
    expect(bestDeals[0].id).toBe(g1.id);
    expect(bestDeals[0].bestDealScore).toBeGreaterThan(80);
    expect(bestDeals[0].bestDealTier).toBe('Exceptional');
    expect(bestDeals[1].id).toBe(g2.id);
  });

  it('filters wishlist games accurately by majorDealsOnly, allTimeLowOnly, and trustedOnly', () => {
    const profile = profileRepo.create('Test User', '76561198000000003');
    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const untrustedShop = merchantRepo.getOrCreate('untrusted', 'Untrusted Keyshop', false);

    // g1_atl: 75% off, NEW_HISTORICAL_LOW (verified by 2 sources)
    const g1_atl = gameRepo.upsert({ steamAppId: 1001, title: 'Game ATL', basePriceEur: 40 });
    gameRepo.updateHistoricalLow(g1_atl.id, 25.00, '2025-01-01', 'steam');

    // g1_major: 60% off (MAJOR_DROP), but ATL was 12.00 so 16.00 is not ATL
    const g1_major = gameRepo.upsert({ steamAppId: 1004, title: 'Game Major Drop', basePriceEur: 40 });
    gameRepo.updateHistoricalLow(g1_major.id, 12.00, '2025-01-01', 'steam');

    // g2: 20% off (MINOR_DROP), Official, Safe
    const g2 = gameRepo.upsert({ steamAppId: 1002, title: 'Game Minor Sale', basePriceEur: 40 });
    // g3: 98% off (Glitch / HIGH Risk), Untrusted keyshop
    const g3 = gameRepo.upsert({ steamAppId: 1003, title: 'Game Shady Glitch', basePriceEur: 40 });

    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1001, title: 'Game ATL', priority: 1 },
      { steamAppId: 1004, title: 'Game Major Drop', priority: 2 },
      { steamAppId: 1002, title: 'Game Minor Sale', priority: 3 },
      { steamAppId: 1003, title: 'Game Shady Glitch', priority: 4 }
    ]);

    // g1_atl has 2 sources to confirm NEW_HISTORICAL_LOW
    offerRepo.upsertOffer({
      gameId: g1_atl.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 10.00,
      originalPriceEur: 40.00,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1001'
    });
    offerRepo.upsertOffer({
      gameId: g1_atl.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 10.00,
      originalPriceEur: 40.00,
      sourceCode: 'itad',
      dealUrl: 'https://store.steampowered.com/app/1001'
    });

    offerRepo.upsertOffer({
      gameId: g1_major.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 16.00,
      originalPriceEur: 40.00,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1004'
    });

    offerRepo.upsertOffer({
      gameId: g2.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 32.00,
      originalPriceEur: 40.00,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/app/1002'
    });

    offerRepo.upsertOffer({
      gameId: g3.id,
      merchantId: untrustedShop.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.80,
      originalPriceEur: 40.00,
      sourceCode: 'cheapshark',
      dealUrl: 'https://untrusted.example/1003'
    });

    // 1. Major Deals Filter: only MAJOR_DROP or EXTREME_DROP
    const majorDeals = gameRepo.getWishlistGames(profile.id, { majorDealsOnly: true });
    expect(majorDeals.games.some(g => g.id === g1_major.id)).toBe(true);
    expect(majorDeals.games.some(g => g.id === g2.id)).toBe(false);

    // 2. All-Time Low Filter: only confirmed ATL
    const atlDeals = gameRepo.getWishlistGames(profile.id, { allTimeLowOnly: true });
    expect(atlDeals.games.some(g => g.id === g1_atl.id)).toBe(true);
    expect(atlDeals.games.some(g => g.id === g2.id)).toBe(false);

    // 3. Trusted Deals Filter: risk IN (SAFE, LOW) AND (official OR trust >= 0.8)
    const trustedDeals = gameRepo.getWishlistGames(profile.id, { trustedOnly: true });
    expect(trustedDeals.games.some(g => g.id === g1_atl.id)).toBe(true);
    expect(trustedDeals.games.some(g => g.id === g1_major.id)).toBe(true);
    expect(trustedDeals.games.some(g => g.id === g2.id)).toBe(true);
    expect(trustedDeals.games.some(g => g.id === g3.id)).toBe(false); // HIGH risk / untrusted keyshop excluded

    // 4. Sort by deal_score_desc
    const sortedByDealScore = gameRepo.getWishlistGames(profile.id, { sort: 'deal_score_desc' });
    expect(sortedByDealScore.games[0].id).toBe(g1_atl.id);
  });

  afterAll(() => {
    closeDb();
  });
});
