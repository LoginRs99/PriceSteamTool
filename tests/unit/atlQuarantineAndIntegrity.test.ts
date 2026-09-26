import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, prepareStmt } from '../../src/server/db/core.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { randomUUID } from 'crypto';
import type { PriceHistoryEntry } from '../../src/shared/types.js';

describe('Step 1: ATL Quarantine & Data Integrity Suite', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM pricing_errors;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM profiles;
      DELETE FROM games;
      DELETE FROM merchants;
    `);
  });

  it('1. Seeded ITAD history glitch (Gatekeeper €0.46 on €12.99 title) is flagged as pricing error and quarantined', () => {
    const now = new Date().toISOString();
    const game = gameRepo.upsert({
      steamAppId: 10001,
      title: 'Gatekeeper',
      basePriceEur: 12.99,
      historicalLowEur: 8.01,
      historicalLowDate: '2025-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    const seedPoints = [
      {
        shopName: 'Sketchy Keyshop',
        priceEur: 0.46, // Extreme outlier glitch (< 5% of MSRP, sub-euro on 12.99 game)
        rawPrice: 0.46,
        rawCurrency: 'EUR',
        discountPercent: 96,
        timestamp: '2025-02-01T00:00:00Z'
      },
      {
        shopName: 'Steam Store',
        priceEur: 8.01,
        rawPrice: 8.01,
        rawCurrency: 'EUR',
        discountPercent: 38,
        timestamp: '2025-01-01T00:00:00Z'
      }
    ];

    offerRepo.seedPriceHistoryForGame(game.id, seedPoints);

    const history = offerRepo.getPriceHistory(game.id, 10);
    const glitchEntry = history.find(h => h.priceEur === 0.46);
    const legitEntry = history.find(h => h.priceEur === 8.01);

    // Glitch entry MUST be detected as pricing error, not hardcoded 0
    expect(glitchEntry).toBeDefined();
    expect(glitchEntry!.isPricingError).toBe(true);
    expect(glitchEntry!.priceEvent).toBe('PRICING_ERROR');

    // Legit entry must remain valid
    expect(legitEntry).toBeDefined();
    expect(legitEntry!.isPricingError).toBe(false);

    // Historical low must NOT be overwritten by the €0.46 glitch
    const updatedGame = gameRepo.getById(game.id)!;
    expect(updatedGame.historicalLowEur).toBe(8.01);
  });

  it('2. Seeded ITAD history sub-euro glitch on €19.99 game (Eliza / Until Then fixture) is quarantined', () => {
    const game = gameRepo.upsert({
      steamAppId: 10002,
      title: 'Until Then',
      basePriceEur: 19.99,
      historicalLowEur: 14.99,
      historicalLowDate: '2025-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    const seedPoints = [
      {
        shopName: 'Dubious Store',
        priceEur: 0.59, // Sub-euro glitch on €19.99 game
        discountPercent: 97,
        timestamp: '2025-02-10T12:00:00Z'
      }
    ];

    offerRepo.seedPriceHistoryForGame(game.id, seedPoints);

    const history = offerRepo.getPriceHistory(game.id, 10);
    expect(history).toHaveLength(1);
    expect(history[0].isPricingError).toBe(true);

    const updatedGame = gameRepo.getById(game.id)!;
    expect(updatedGame.historicalLowEur).toBe(14.99);
  });

  it('3. Unconfirmed single-source keyshop price drop is quarantined from overwriting historical_low_eur', () => {
    const now = new Date().toISOString();
    const game = gameRepo.upsert({
      steamAppId: 10003,
      title: 'MythForce',
      basePriceEur: 29.99,
      historicalLowEur: 14.99,
      historicalLowDate: '2025-01-01T00:00:00Z',
      historicalLowSource: 'Steam Store'
    });

    // Unconfirmed keyshop calls updateHistoricalLow
    gameRepo.updateHistoricalLow(game.id, 2.99, now, 'AllKeyShop (Kinguin)');

    const updatedGame = gameRepo.getById(game.id)!;
    // An unconfirmed keyshop drop must NOT overwrite the established historical low
    expect(updatedGame.historicalLowEur).toBe(14.99);
  });

  it('4. Corroborated keyshop drop (2+ independent sources) successfully updates confirmed historical_low_eur', () => {
    const now = new Date().toISOString();
    const game = gameRepo.upsert({
      steamAppId: 10004,
      title: 'Corroborated Low Title',
      basePriceEur: 29.99,
      historicalLowEur: 14.99,
      historicalLowDate: '2025-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    const merchant = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);
    const offerId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_likely_pricing_error, is_best_deal, deal_url, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'STEAM_KEY', 'GLOBAL', 9.99, 1, 0, 1, 'https://kinguin.net', ?, ?, ?, ?)
    `).run(offerId, game.id, merchant.id, now, now, now, now);

    // Corroborated by 2 distinct sources: allkeyshop and ggdeals
    prepareStmt(`
      INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at)
      VALUES (?, ?, 'allkeyshop', 9.99, ?), (?, ?, 'ggdeals', 9.99, ?)
    `).run(randomUUID(), offerId, now, randomUUID(), offerId, now);

    // Recompute best deal
    offerRepo.recomputeBestDealForGame(game.id);

    const updatedGame = gameRepo.getById(game.id)!;
    // With 2+ independent sources corroborating, the drop is promoted out of quarantine
    expect(updatedGame.historicalLowEur).toBe(9.99);
    expect(updatedGame.atlIsConfirmed).toBe(true);
  });

  it('5. Legitimate official store price drop immediately updates confirmed ATL', () => {
    const now = new Date().toISOString();
    const game = gameRepo.upsert({
      steamAppId: 10005,
      title: 'Official Drop Title',
      basePriceEur: 39.99,
      historicalLowEur: 19.99,
      historicalLowDate: '2025-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    gameRepo.updateHistoricalLow(game.id, 9.99, now, 'Steam Store');

    const updatedGame = gameRepo.getById(game.id)!;
    expect(updatedGame.historicalLowEur).toBe(9.99);
    expect(updatedGame.atlIsConfirmed).toBe(true);
    expect(updatedGame.atlIsSingleSourceLow).toBe(false);
  });

  it('6. Legitimate historical sales (e.g. 80% off Portal 2) retain is_pricing_error = 0 and contribute to typical sale', () => {
    const game = gameRepo.upsert({
      steamAppId: 10006,
      title: 'Portal 2',
      basePriceEur: 19.99,
      historicalLowEur: 4.99,
      historicalLowDate: '2024-01-01T00:00:00Z',
      historicalLowSource: 'Steam'
    });

    const legitimatePoints = [
      {
        shopName: 'Steam',
        priceEur: 1.99,
        discountPercent: 90,
        timestamp: '2024-06-20T17:00:00Z'
      },
      {
        shopName: 'Humble Store',
        priceEur: 2.99,
        discountPercent: 85,
        timestamp: '2024-03-15T12:00:00Z'
      }
    ];

    offerRepo.seedPriceHistoryForGame(game.id, legitimatePoints);

    const history = offerRepo.getPriceHistory(game.id, 10);
    expect(history.every(h => h.isPricingError === false)).toBe(true);

    const updatedGame = gameRepo.getById(game.id)!;
    expect(updatedGame.historicalLowEur).toBe(1.99);
    expect(updatedGame.typicalSaleMedianEur).toBeGreaterThan(0);
  });
});
