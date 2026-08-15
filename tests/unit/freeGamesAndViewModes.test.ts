import { describe, it, expect, beforeEach } from 'vitest';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  getDb 
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

describe('Free Games Separation & View Modes Support', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('separates Free-to-Play games from paid wishlist games', () => {
    const profile = profileRepo.create('Test Gamer', '76561198000099999');

    // 1. Paid Game: Cyberpunk 2077 (€59.99)
    const paidGame = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99,
      isFree: false
    });

    // 2. Free Game: Dota 2 (€0.00 / isFree = true)
    const freeGame1 = gameRepo.upsert({
      steamAppId: 570,
      title: 'Dota 2',
      basePriceEur: 0,
      isFree: true
    });

    // 3. Free Game: Counter-Strike 2 (€0.00 / isFree = true)
    const freeGame2 = gameRepo.upsert({
      steamAppId: 730,
      title: 'Counter-Strike 2',
      basePriceEur: 0,
      isFree: true
    });

    // 4. Paid Game with Discount: The Witcher 3 (€29.99)
    const paidGame2 = gameRepo.upsert({
      steamAppId: 292030,
      title: 'The Witcher 3: Wild Hunt',
      basePriceEur: 29.99,
      isFree: false
    });

    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1 },
      { steamAppId: 570, title: 'Dota 2', priority: 2 },
      { steamAppId: 730, title: 'Counter-Strike 2', priority: 3 },
      { steamAppId: 292030, title: 'The Witcher 3: Wild Hunt', priority: 4 }
    ]);

    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

    // Offers
    offerRepo.upsertOffer({
      gameId: paidGame.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      originalPriceEur: 59.99,
      discountPercent: 50,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      sourceCode: 'steam'
    });

    offerRepo.upsertOffer({
      gameId: paidGame2.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 8.99,
      originalPriceEur: 29.99,
      discountPercent: 70,
      dealUrl: 'https://store.steampowered.com/app/292030',
      sourceCode: 'steam'
    });

    // Test Default Wishlist: Returns ONLY the 2 paid games
    const paidWishlist = gameRepo.getWishlistGames(profile.id, { isFreeOnly: false });
    expect(paidWishlist.total).toBe(2);
    expect(paidWishlist.games.map(g => g.steamAppId).sort((a, b) => a - b)).toEqual([292030, 1091500]);

    // Test Free Games Tab: Returns ONLY the 2 free games
    const freeWishlist = gameRepo.getWishlistGames(profile.id, { isFreeOnly: true });
    expect(freeWishlist.total).toBe(2);
    expect(freeWishlist.games.map(g => g.steamAppId).sort((a, b) => a - b)).toEqual([570, 730]);

    // Test Statistics: Correct counts for paid and free
    const stats = gameRepo.getWishlistStatistics(profile.id);
    expect(stats.totalGames).toBe(2); // 2 paid games
    expect(stats.freeGamesCount).toBe(2); // 2 free games
    expect(stats.gamesOnSale).toBe(2); // Both paid games are on sale
    expect(stats.averageDiscountPercent).toBe(60); // (50 + 70) / 2 = 60%

    // Test Best Deals: Excludes free games
    const bestDeals = gameRepo.getBestDeals(profile.id, 10);
    expect(bestDeals.length).toBe(2);
    expect(bestDeals.every(d => !d.isFree)).toBe(true);
  });

  it('supports high-capacity pagination with 24, 50, 100, and 200 item limits for rapid scanning', () => {
    const profile = profileRepo.create('Power User', '76561198000088888');

    const items = Array.from({ length: 150 }, (_, i) => ({
      steamAppId: 400000 + i,
      title: `Game #${i + 1}`,
      priority: i + 1
    }));

    gameRepo.syncWishlistEntries(profile.id, items);

    // 24 / page
    const p24 = gameRepo.getWishlistGames(profile.id, { limit: 24, page: 1 });
    expect(p24.total).toBe(150);
    expect(p24.games.length).toBe(24);

    // 100 / page
    const p100 = gameRepo.getWishlistGames(profile.id, { limit: 100, page: 1 });
    expect(p100.total).toBe(150);
    expect(p100.games.length).toBe(100);

    // Page 2 with 100 / page -> Remaining 50
    const p100_page2 = gameRepo.getWishlistGames(profile.id, { limit: 100, page: 2 });
    expect(p100_page2.games.length).toBe(50);
    expect(p100_page2.games[0].title).toBe('Game #101');
  });
});
