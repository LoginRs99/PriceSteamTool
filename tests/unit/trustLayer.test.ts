import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, gameRepo, merchantRepo, offerRepo, profileRepo } from '../../src/server/db/index.js';
import { exchangeRateService } from '../../src/server/domain/exchangeRate.js';
import { prepareStmt } from '../../src/server/db/core.js';

describe('Trust Layer — P0.1 Active Offer Selection & P0.2 Currency FX Integrity', () => {
  beforeEach(() => {
    exchangeRateService.resetRates();
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM games;
      DELETE FROM merchants;
      DELETE FROM profiles;
    `);
  });

  afterEach(() => {
    exchangeRateService.resetRates();
  });

  describe('P0.1: Deterministic Active Offer Conflict Resolution', () => {
    it('selects lowest valid comparable price when multiple sources observe the same canonical offer', () => {
      const profile = profileRepo.create('Test User', '76561198000000001');
      const game = gameRepo.upsert({ steamAppId: 1086940, title: "Baldur's Gate 3", basePriceEur: 59.99 });
      const merchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

      // Ingest ITAD (€14.99 with voucher)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        originalPriceEur: 59.99,
        voucherCode: 'FANATICAL10',
        dealUrl: 'https://fanatical.com/deal-itad',
        sourceCode: 'itad',
        isValid: true
      });

      // Ingest GG.deals (€15.49 without voucher)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 15.49,
        originalPriceEur: 59.99,
        dealUrl: 'https://gg.deals/deal-gg',
        sourceCode: 'ggdeals',
        isValid: true
      });

      // Ingest AllKeyShop (€16.50)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 16.50,
        originalPriceEur: 59.99,
        dealUrl: 'https://allkeyshop.com/deal-aks',
        sourceCode: 'allkeyshop',
        isValid: true
      });

      const offers = offerRepo.getOffersForGame(game.id);
      expect(offers.length).toBe(1);

      const active = offers[0];
      // Lowest price (€14.99) must be the active price
      expect(active.priceEur).toBe(14.99);
      expect(active.voucherCode).toBe('FANATICAL10');
      expect(active.dealUrl).toBe('https://fanatical.com/deal-itad');

      // Both/all source observations must be preserved
      const obs = prepareStmt(`SELECT * FROM source_observations WHERE offer_id = ? ORDER BY source_code ASC`).all(active.id) as any[];
      expect(obs.length).toBe(3);
      expect(obs.map(o => o.source_code)).toEqual(['allkeyshop', 'ggdeals', 'itad']);
    });

    it('is completely invariant to ingestion arrival order (reverse arrival order)', () => {
      const profile = profileRepo.create('Test User 2', '76561198000000002');
      const game = gameRepo.upsert({ steamAppId: 1086940, title: "Baldur's Gate 3", basePriceEur: 59.99 });
      const merchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

      // Ingest AllKeyShop FIRST (€16.50)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 16.50,
        originalPriceEur: 59.99,
        dealUrl: 'https://allkeyshop.com/deal-aks',
        sourceCode: 'allkeyshop',
        isValid: true
      });

      // Ingest GG.deals SECOND (€15.49)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 15.49,
        originalPriceEur: 59.99,
        dealUrl: 'https://gg.deals/deal-gg',
        sourceCode: 'ggdeals',
        isValid: true
      });

      // Ingest ITAD LAST (€14.99 with voucher)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        originalPriceEur: 59.99,
        voucherCode: 'FANATICAL10',
        dealUrl: 'https://fanatical.com/deal-itad',
        sourceCode: 'itad',
        isValid: true
      });

      const offers = offerRepo.getOffersForGame(game.id);
      expect(offers.length).toBe(1);

      const active = offers[0];
      // Must still be €14.99 with ITAD voucher
      expect(active.priceEur).toBe(14.99);
      expect(active.voucherCode).toBe('FANATICAL10');
      expect(active.dealUrl).toBe('https://fanatical.com/deal-itad');
    });

    it('does not collapse distinct product types or regions into a single offer', () => {
      const profile = profileRepo.create('Test User 3', '76561198000000003');
      const game = gameRepo.upsert({ steamAppId: 1091500, title: 'Cyberpunk 2077', basePriceEur: 59.99 });
      const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Steam Direct Purchase
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 29.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://store.steampowered.com/app/1091500',
        sourceCode: 'steam',
        isValid: true
      });

      // Steam Key
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 19.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://fanatical.com/cyberpunk',
        sourceCode: 'itad',
        isValid: true
      });

      // EU-specific Key
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 18.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://eu.store/cyberpunk',
        sourceCode: 'itad',
        isValid: true
      });

      const offers = offerRepo.getOffersForGame(game.id);
      expect(offers.length).toBe(3);
    });
  });

  describe('P0.2: Currency & FX Historical Integrity', () => {
    it('prevents false price movements and false historical lows when native price is unchanged but FX changes', () => {
      const profile = profileRepo.create('FX User', '76561198000000004');
      const game = gameRepo.upsert({ steamAppId: 730, title: 'Counter-Strike 2', basePriceEur: 14.99 });
      const merchant = merchantRepo.getOrCreate('us_store', 'US Digital Store', true);

      // Day 1: Store price is $10.00 USD @ FX rate 0.92 -> €9.20 EUR
      exchangeRateService.setRate('USD', 0.92);
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        rawPrice: 10.00,
        rawCurrency: 'USD',
        priceEur: 9.20,
        originalPriceEur: 14.99,
        dealUrl: 'https://us_store.com/game',
        sourceCode: 'cheapshark',
        isValid: true
      });

      let historyRows = prepareStmt(`SELECT * FROM price_history WHERE game_id = ?`).all(game.id) as any[];
      expect(historyRows.length).toBe(1);
      expect(historyRows[0].price_eur).toBe(9.20);
      expect(historyRows[0].raw_price).toBe(10.00);
      expect(historyRows[0].raw_currency).toBe('USD');

      // Day 30: Store price is STILL $10.00 USD, but FX rate moved to 0.85 -> €8.50 EUR
      exchangeRateService.setRate('USD', 0.85);
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        rawPrice: 10.00,
        rawCurrency: 'USD',
        priceEur: 8.50,
        originalPriceEur: 14.99,
        dealUrl: 'https://us_store.com/game',
        sourceCode: 'cheapshark',
        isValid: true
      });

      // No new price history row should be created because the store price ($10.00 USD) was unchanged!
      historyRows = prepareStmt(`SELECT * FROM price_history WHERE game_id = ?`).all(game.id) as any[];
      expect(historyRows.length).toBe(1);

      // Historical low must not be falsely lowered to 8.50
      const gameRecord = gameRepo.getById(game.id);
      expect(gameRecord?.historicalLowEur).not.toBe(8.50);
    });

    it('accurately detects genuine merchant price changes in foreign currency ($10 -> $8)', () => {
      const profile = profileRepo.create('FX User 2', '76561198000000005');
      const game = gameRepo.upsert({ steamAppId: 570, title: 'Dota 2', basePriceEur: 19.99 });
      const merchant = merchantRepo.getOrCreate('us_store', 'US Digital Store', true);

      // Day 1: Store price is $10.00 USD @ FX 0.92 -> €9.20 EUR
      exchangeRateService.setRate('USD', 0.92);
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        rawPrice: 10.00,
        rawCurrency: 'USD',
        priceEur: 9.20,
        dealUrl: 'https://us_store.com/game',
        sourceCode: 'cheapshark',
        isValid: true
      });

      // Day 15: Store genuinely cuts price to $8.00 USD @ FX 0.90 -> €7.20 EUR
      exchangeRateService.setRate('USD', 0.90);
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        rawPrice: 8.00,
        rawCurrency: 'USD',
        priceEur: 7.20,
        dealUrl: 'https://us_store.com/game',
        sourceCode: 'cheapshark',
        isValid: true
      });

      const historyRows = prepareStmt(`SELECT * FROM price_history WHERE game_id = ? ORDER BY recorded_at ASC`).all(game.id) as any[];
      expect(historyRows.length).toBe(2);
      expect(historyRows[1].raw_price).toBe(8.00);
      expect(historyRows[1].price_eur).toBe(7.20);
    });
  });
});
