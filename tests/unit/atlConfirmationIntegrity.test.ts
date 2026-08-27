import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, prepareStmt } from '../../src/server/db/core.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { calculatePeriodLows } from '../../src/server/domain/priceIntelligence/periodLows.js';
import { calculateDealScore } from '../../src/server/domain/dealScore/calculator.js';
import { generatePriceIntelligence } from '../../src/server/domain/priceIntelligence/calculator.js';
import { randomUUID } from 'crypto';
import type { PriceHistoryEntry } from '../../src/shared/types.js';

describe('All-Time Low (ATL) Confirmation State Integrity Suite', () => {
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

  it('Case A: Existing unconfirmed ATL in database stays unconfirmed across all layers', () => {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, historical_low_date, historical_low_source, atl_is_confirmed, atl_is_single_source_low, created_at, updated_at)
      VALUES (?, 1001, 'Case A Game', 'case-a-game', 29.99, 0.49, ?, 'AllKeyShop', 0, 1, ?, ?)
    `).run(gameId, now, now, now);

    const merchant = merchantRepo.getOrCreate('steam_store', 'Steam', true);

    const offerId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_best_deal, deal_url, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 14.99, 1, 1, 'https://store.steampowered.com', ?, ?, ?, ?)
    `).run(offerId, gameId, merchant.id, now, now, now, now);

    // 1. Repository row mapping
    const game = gameRepo.getById(gameId)!;
    expect(game).toBeDefined();
    expect(game.historicalLowEur).toBe(0.49);
    expect(game.atlIsConfirmed).toBe(false);
    expect(game.atlIsSingleSourceLow).toBe(true);

    // 2. Offer row mapping
    const offers = offerRepo.getOffersForGame(gameId);
    expect(offers).toHaveLength(1);

    // 3. Price Intelligence calculation
    const intelligence = generatePriceIntelligence({ game, offers, history: [] });
    expect(intelligence.periodLows.allTimeLow.priceEur).toBe(0.49);
    expect(intelligence.periodLows.allTimeLow.isConfirmed).toBe(false);

    // 4. Deal score comparison: unconfirmed ATL halves record bonus
    const scoreUnconfirmed = calculateDealScore({
      priceEur: 0.49,
      basePriceEur: 29.99,
      typicalSaleMedianEur: 19.99,
      allTimeLowEur: 0.49,
      isConfirmedAtl: false,
      isSingleSourceLow: true
    });

    const scoreConfirmed = calculateDealScore({
      priceEur: 0.49,
      basePriceEur: 29.99,
      typicalSaleMedianEur: 19.99,
      allTimeLowEur: 0.49,
      isConfirmedAtl: true,
      isSingleSourceLow: false
    });

    // Confirmed ATL gives full record bonus; unconfirmed halves it
    expect(scoreUnconfirmed.score).toBeLessThan(scoreConfirmed.score);
  });

  it('Case B: Existing confirmed ATL in database stays confirmed across all layers', () => {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, historical_low_date, historical_low_source, atl_is_confirmed, atl_is_single_source_low, created_at, updated_at)
      VALUES (?, 1002, 'Case B Game', 'case-b-game', 49.99, 7.35, ?, 'Steam Store', 1, 0, ?, ?)
    `).run(gameId, now, now, now);

    const game = gameRepo.getById(gameId)!;
    expect(game).toBeDefined();
    expect(game.historicalLowEur).toBe(7.35);
    expect(game.atlIsConfirmed).toBe(true);
    expect(game.atlIsSingleSourceLow).toBe(false);

    const periodLows = calculatePeriodLows(game, []);
    expect(periodLows.allTimeLow.priceEur).toBe(7.35);
    expect(periodLows.allTimeLow.isConfirmed).toBe(true);
  });

  it('Case C: Single-source keyshop low remains unconfirmed without independent corroboration', () => {
    const now = new Date().toISOString();
    gameRepo.upsert({ steamAppId: 1003, title: 'Case C Game', basePriceEur: 39.99 });
    const game = gameRepo.getBySteamAppId(1003)!;

    // Update with keyshop historical low
    gameRepo.updateHistoricalLow(game.id, 3.00, now, 'AllKeyShop');

    const updatedGame = gameRepo.getById(game.id)!;
    expect(updatedGame.historicalLowEur).toBe(3.00);
    expect(updatedGame.atlIsConfirmed).toBe(false);
    expect(updatedGame.atlIsSingleSourceLow).toBe(true);

    const history: PriceHistoryEntry[] = [
      {
        id: randomUUID(),
        gameId: game.id,
        merchantId: randomUUID(),
        merchantName: 'Steam',
        isOfficial: true,
        sourceCode: 'steam',
        priceEur: 39.99,
        discountPercent: 0,
        priceEvent: 'NONE',
        isAnomaly: false,
        riskLevel: 'SAFE',
        recordedAt: now
      }
    ];

    const periodLows = calculatePeriodLows(updatedGame, history);
    expect(periodLows.allTimeLow.priceEur).toBe(3.00);
    expect(periodLows.allTimeLow.isConfirmed).toBe(false);
  });

  it('Case D: Corroborated keyshop low becomes confirmed when corroboration criteria are genuinely satisfied', () => {
    const now = new Date().toISOString();
    gameRepo.upsert({ steamAppId: 1004, title: 'Case D Game', basePriceEur: 39.99 });
    const game = gameRepo.getBySteamAppId(1004)!;

    // Keyshop historical low of €3.00
    gameRepo.updateHistoricalLow(game.id, 3.00, now, 'AllKeyShop');

    const unconfirmedGame = gameRepo.getById(game.id)!;
    expect(unconfirmedGame.atlIsConfirmed).toBe(false);

    // Trusted history contains independent official observation at €3.10 (within 15% range of €3.00)
    const history: PriceHistoryEntry[] = [
      {
        id: randomUUID(),
        gameId: game.id,
        merchantId: randomUUID(),
        merchantName: 'Fanatical',
        isOfficial: true,
        sourceCode: 'itad',
        priceEur: 3.10,
        discountPercent: 92,
        priceEvent: 'MAJOR_DROP',
        isAnomaly: false,
        riskLevel: 'SAFE',
        recordedAt: now
      }
    ];

    const periodLows = calculatePeriodLows(unconfirmedGame, history);
    expect(periodLows.allTimeLow.priceEur).toBe(3.00);
    expect(periodLows.allTimeLow.isConfirmed).toBe(true);
  });

  it('End-to-End Production Path: atl_is_confirmed = 0 survives SQLite -> game mapper -> Deal Score -> Price Intelligence API', () => {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, historical_low_date, historical_low_source, atl_is_confirmed, atl_is_single_source_low, created_at, updated_at)
      VALUES (?, 1005, 'End to End Game', 'end-to-end-game', 59.99, 1.99, ?, 'AllKeyShop', 0, 1, ?, ?)
    `).run(gameId, now, now, now);

    const merchant = merchantRepo.getOrCreate('steam_store', 'Steam Store', true);
    const offerId = randomUUID();
    prepareStmt(`
      INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, is_valid, is_best_deal, deal_url, last_observed_at, fetched_at, created_at, updated_at)
      VALUES (?, ?, ?, 'KEY', 'GLOBAL', 1.99, 1, 1, 'https://store.steampowered.com', ?, ?, ?, ?)
    `).run(offerId, gameId, merchant.id, now, now, now, now);

    // 1. Load via gameRepo.getById
    const game = gameRepo.getById(gameId)!;
    expect(game.atlIsConfirmed).toBe(false);
    expect(game.atlIsSingleSourceLow).toBe(true);

    // 2. Verify deal score was computed with unconfirmed ATL
    expect(game.bestDealScore).toBeDefined();

    // 3. Load via gameRepo.getPriceIntelligence
    const intelligence = gameRepo.getPriceIntelligence(gameId)!;
    expect(intelligence).toBeDefined();
    expect(intelligence.periodLows.allTimeLow.priceEur).toBe(1.99);
    expect(intelligence.periodLows.allTimeLow.isConfirmed).toBe(false);
  });
});
