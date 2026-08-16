import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  getDb, 
  closeDb 
} from '../../src/server/db/index.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM notifications_log;
    DELETE FROM sync_runs;
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

describe('v1.1 Foundation — Data Quality & Deal System', () => {
  beforeEach(() => {
    resetDatabase();
  });

  // ----------------------------------------------------
  // 1. Currency Correctness & Preservation
  // ----------------------------------------------------
  it('preserves raw source currency & price alongside normalized EUR price', () => {
    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

    const offer = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      originalPriceEur: 59.99,
      rawPrice: 29.99,
      rawCurrency: 'EUR',
      rawOriginalPrice: 59.99,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      sourceCode: 'steam'
    });

    expect(offer.priceEur).toBe(29.99);
    expect(offer.rawPrice).toBe(29.99);
    expect(offer.rawCurrency).toBe('EUR');
    expect(offer.rawOriginalPrice).toBe(59.99);

    // Foreign currency from another source (e.g. CheapShark with USD)
    const csMerchant = merchantRepo.getOrCreate('gog', 'GOG.com', true);
    const csOffer = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: csMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 18.40, // 20.00 USD converted to EUR
      originalPriceEur: 55.20,
      rawPrice: 20.00,
      rawCurrency: 'USD',
      rawOriginalPrice: 60.00,
      dealUrl: 'https://gog.com/game',
      sourceCode: 'cheapshark'
    });

    expect(csOffer.priceEur).toBe(18.40);
    expect(csOffer.rawPrice).toBe(20.00);
    expect(csOffer.rawCurrency).toBe('USD');
  });

  // ----------------------------------------------------
  // 2. Computed Source Agreement (COUNT DISTINCT)
  // ----------------------------------------------------
  it('calculates source_agreement_count as query-derived count of distinct sources', () => {
    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    const merchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

    // 1st observation from ITAD
    const offer1 = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://fanatical.com/game',
      sourceCode: 'itad'
    });
    expect(offer1.sourceAgreementCount).toBe(1);
    expect(offer1.sources).toEqual(['itad']);

    // 2nd observation from GG.deals for the SAME canonical offer
    const offer2 = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://fanatical.com/game',
      sourceCode: 'ggdeals'
    });
    expect(offer2.id).toBe(offer1.id);
    expect(offer2.sourceAgreementCount).toBe(2);
    expect(offer2.sources.sort()).toEqual(['ggdeals', 'itad']);

    // 3rd observation from CheapShark for the SAME canonical offer
    const offer3 = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://fanatical.com/game',
      sourceCode: 'cheapshark'
    });
    expect(offer3.id).toBe(offer1.id);
    expect(offer3.sourceAgreementCount).toBe(3);
    expect(offer3.sources.sort()).toEqual(['cheapshark', 'ggdeals', 'itad']);
  });

  // ----------------------------------------------------
  // 3. Price Freshness & Stale Data Confidence Penalty
  // ----------------------------------------------------
  it('penalizes confidence for stale observations without falsely marking as anomaly', () => {
    // Normal fresh evaluation
    const freshEval = evaluatePriceMovement({
      currentPriceEur: 15.00,
      basePriceEur: 60.00,
      sourceAgreementCount: 2,
      isOfficialMerchant: true,
      isStaleObservation: false
    });

    expect(freshEval.isAnomaly).toBe(false);
    expect(freshEval.riskLevel).not.toBe('HIGH');
    expect(freshEval.confidence).toBeGreaterThanOrEqual(0.65);

    // Stale observation evaluation
    const staleEval = evaluatePriceMovement({
      currentPriceEur: 15.00,
      basePriceEur: 60.00,
      sourceAgreementCount: 2,
      isOfficialMerchant: true,
      isStaleObservation: true
    });

    // Stale data lowers confidence by -0.20, but is NOT marked as anomaly
    expect(staleEval.isAnomaly).toBe(false);
    expect(staleEval.riskLevel).not.toBe('HIGH');
    expect(staleEval.confidence).toBeLessThan(freshEval.confidence);
    expect(staleEval.riskFlags).toContain('STALE_OBSERVATION');
  });

  // ----------------------------------------------------
  // 4. Idempotent Price History Tracking
  // ----------------------------------------------------
  it('maintains strict price_history idempotency and logs only genuine price movements', () => {
    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

    // Initial offer (Price: 59.99 EUR)
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 59.99,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      sourceCode: 'steam'
    });
    expect(offerRepo.getPriceHistory(game.id).length).toBe(1);

    // 5 Repeated sync runs with the EXACT same price
    for (let i = 0; i < 5; i++) {
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 59.99,
        dealUrl: 'https://store.steampowered.com/app/1091500',
        sourceCode: 'steam'
      });
    }
    // Still exactly 1 row (no bloat)
    expect(offerRepo.getPriceHistory(game.id).length).toBe(1);

    // Real price drop to 29.99 EUR
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      originalPriceEur: 59.99,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      sourceCode: 'steam'
    });
    expect(offerRepo.getPriceHistory(game.id).length).toBe(2);

    // Price returns to 59.99 EUR
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 59.99,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      sourceCode: 'steam'
    });
    expect(offerRepo.getPriceHistory(game.id).length).toBe(3);
  });

  // ----------------------------------------------------
  // 5. Batch Steam Metadata Ingestion
  // ----------------------------------------------------
  it('ingests batch wishlist items with full metadata and updates games table', () => {
    const profile = profileRepo.create('Test User', '76561198000000001');

    const batchItems = [
      {
        steamAppId: 1091500,
        title: 'Cyberpunk 2077',
        priority: 1,
        headerImage: 'https://cdn.steam.com/cp2077.jpg',
        releaseDate: '10 Dec, 2020',
        basePriceEur: 59.99,
        isDlc: false,
        isFree: false
      },
      {
        steamAppId: 292030,
        title: 'The Witcher 3: Wild Hunt',
        priority: 2,
        headerImage: 'https://cdn.steam.com/witcher3.jpg',
        releaseDate: '18 May, 2015',
        basePriceEur: 29.99,
        isDlc: false,
        isFree: false
      }
    ];

    gameRepo.syncWishlistEntries(profile.id, batchItems);

    const cpGame = gameRepo.getBySteamAppId(1091500);
    expect(cpGame).not.toBeNull();
    expect(cpGame!.title).toBe('Cyberpunk 2077');
    expect(cpGame!.headerImage).toBe('https://cdn.steam.com/cp2077.jpg');
    expect(cpGame!.basePriceEur).toBe(59.99);

    const w3Game = gameRepo.getBySteamAppId(292030);
    expect(w3Game).not.toBeNull();
    expect(w3Game!.title).toBe('The Witcher 3: Wild Hunt');
    expect(w3Game!.basePriceEur).toBe(29.99);
  });
});
