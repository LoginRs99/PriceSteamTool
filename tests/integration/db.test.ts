import { describe, it, expect, beforeEach } from 'vitest';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  getDb 
} from '../../src/server/db/index.js';

describe('Database Integration, Deduplication & Cache-First Queries', () => {
  beforeEach(() => {
    // Clear test tables
    const db = getDb();
    db.prepare(`DELETE FROM profiles`).run();
    db.prepare(`DELETE FROM games`).run();
    db.prepare(`DELETE FROM merchants`).run();
    db.prepare(`DELETE FROM offers`).run();
    db.prepare(`DELETE FROM price_history`).run();
  });

  it('creates profiles and manages active state', () => {
    const p1 = profileRepo.create('Profile One', '76561198000000001');
    expect(p1.isActive).toBe(true);

    const p2 = profileRepo.create('Profile Two', '76561198000000002');
    expect(p2.isActive).toBe(false);

    profileRepo.setActive(p2.id);
    const active = profileRepo.getActive();
    expect(active?.id).toBe(p2.id);
    expect(active?.name).toBe('Profile Two');
  });

  it('deduplicates offers for the same merchant and preserves multi-source observations', () => {
    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });

    const merchant = merchantRepo.getOrCreate('k4g', 'K4G', false);

    // 1. First observation from ITAD
    const offer1 = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 18.42,
      originalPriceEur: 59.99,
      dealUrl: 'https://k4g.com/cyberpunk',
      sourceCode: 'itad'
    });

    expect(offer1.priceEur).toBe(18.42);
    expect(offer1.sources).toContain('itad');
    expect(offer1.sources.length).toBe(1);

    // 2. Second observation from GG.deals for the SAME merchant & product type
    const offer2 = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 18.20, // updated freshest price
      originalPriceEur: 59.99,
      dealUrl: 'https://k4g.com/cyberpunk',
      sourceCode: 'ggdeals'
    });

    // Should update existing offer ID rather than creating a duplicate row
    expect(offer2.id).toBe(offer1.id);
    expect(offer2.priceEur).toBe(18.20);
    expect(offer2.sources).toContain('itad');
    expect(offer2.sources).toContain('ggdeals');
    expect(offer2.sources.length).toBe(2);

    // Total offers for this game should still be exactly 1
    const allOffers = offerRepo.getOffersForGame(game.id);
    expect(allOffers.length).toBe(1);
  });

  it('maintains price_history idempotency (no duplicate entries when price is unchanged)', () => {
    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    const merchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

    // First observation: €19.99
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://fanatical',
      sourceCode: 'itad'
    });

    // Second sync with identical price: €19.99
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://fanatical',
      sourceCode: 'itad'
    });

    // History should have exactly 1 record
    let history = offerRepo.getPriceHistory(game.id);
    expect(history.length).toBe(1);

    // Third sync with a price drop: €16.99
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 16.99,
      dealUrl: 'https://fanatical',
      sourceCode: 'itad'
    });

    // History should now have 2 records
    history = offerRepo.getPriceHistory(game.id);
    expect(history.length).toBe(2);
    expect(history[0].priceEur).toBe(16.99);
    expect(history[1].priceEur).toBe(19.99);
  });

  it('identifies stale wishlist games for cache-first sync', () => {
    const profile = profileRepo.create('Cache Test Profile', '76561198999999999');

    // Game 1: Has fresh offer (fetched now)
    const g1 = gameRepo.upsert({ steamAppId: 100, title: 'Game 100' });
    // Game 2: Has no offers
    const g2 = gameRepo.upsert({ steamAppId: 200, title: 'Game 200' });

    gameRepo.syncWishlistEntries(profile.id, [
      { steamAppId: 100, title: 'Game 100', priority: 1 },
      { steamAppId: 200, title: 'Game 200', priority: 2 }
    ]);

    const m = merchantRepo.getOrCreate('steam', 'Steam', true);
    offerRepo.upsertOffer({
      gameId: g1.id,
      merchantId: m.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      dealUrl: 'https://steam',
      sourceCode: 'steam'
    });

    const stale = gameRepo.getStaleWishlistGameIds(profile.id, 6);
    // Only Game 2 should be in stale list!
    expect(stale.length).toBe(1);
    expect(stale[0].steamAppId).toBe(200);
  });
});
