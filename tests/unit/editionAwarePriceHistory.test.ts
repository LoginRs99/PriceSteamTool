import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeEdition } from '../../src/server/domain/edition.js';
import { getDb, offerRepo, gameRepo, merchantRepo } from '../../src/server/db/index.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM offers;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM merchants;
  `);
}

describe('Edition-Aware Price History & Stream Ingestion Identity', () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
  });

  describe('1. normalizeEdition domain normalization', () => {
    it('normalizes standard editions to standard canonical key', () => {
      expect(normalizeEdition('Standard Edition', 'MY HERO ONE\'S JUSTICE 2', 'nexarda')).toEqual({
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'CONFIDENT',
      });
      expect(normalizeEdition(undefined, 'Game Title', 'steam')).toEqual({
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'CONFIDENT',
      });
    });

    it('normalizes deluxe, ultimate, and goty editions reliably', () => {
      expect(normalizeEdition('Deluxe Edition', 'Starlink', 'nexarda')).toEqual({
        editionKey: 'deluxe',
        editionName: 'Deluxe Edition',
        identityConfidence: 'CONFIDENT',
      });
      expect(normalizeEdition('Ultimate Edition', 'Control', 'cheapshark')).toEqual({
        editionKey: 'ultimate',
        editionName: 'Ultimate Edition',
        identityConfidence: 'CONFIDENT',
      });
      expect(normalizeEdition('Game of the Year Edition', 'Witcher 3', 'nexarda')).toEqual({
        editionKey: 'goty',
        editionName: 'GOTY Edition',
        identityConfidence: 'CONFIDENT',
      });
    });

    it('extracts edition from game title when raw edition is empty', () => {
      const res = normalizeEdition(undefined, 'Starlink: Battle for Atlas - Deluxe Edition', 'cheapshark');
      expect(res.editionKey).toBe('deluxe');
      expect(res.editionName).toBe('Deluxe Edition');
      expect(res.identityConfidence).toBe('CONFIDENT');
    });
  });

  describe('2. Multi-edition price stream separation in repository', () => {
    let gameId: string;
    let merchantId: string;

    beforeEach(() => {
      const game = gameRepo.upsert({
        steamAppId: 105600,
        title: "MY HERO ONE'S JUSTICE 2",
        slug: 'my-hero-ones-justice-2',
        basePriceEur: 59.99,
        historicalLowEur: 36.29,
        isDlc: false,
        isFree: false,
      });
      gameId = game.id;

      const merchant = merchantRepo.getOrCreate('indiegala', 'IndieGala', true);
      merchantId = merchant.id;
    });

    it('maintains separate offer rows and price history streams for Standard and Deluxe', () => {
      // Step 1: Ingest Standard Edition at €36.29
      const standardOffer = offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 36.29,
        originalPriceEur: 59.99,
        dealUrl: 'https://indiegala.com/standard',
        sourceCode: 'nexarda',
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'CONFIDENT',
      });

      expect(standardOffer).toBeDefined();
      expect(standardOffer.editionKey).toBe('standard');
      expect(standardOffer.priceEur).toBe(36.29);

      // Step 2: Ingest Deluxe Edition from same merchant at €54.44 (16ms later)
      const deluxeOffer = offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 54.44,
        originalPriceEur: 79.99,
        dealUrl: 'https://indiegala.com/deluxe',
        sourceCode: 'nexarda',
        editionKey: 'deluxe',
        editionName: 'Deluxe Edition',
        identityConfidence: 'CONFIDENT',
      });

      expect(deluxeOffer).toBeDefined();
      expect(deluxeOffer.editionKey).toBe('deluxe');
      expect(deluxeOffer.priceEur).toBe(54.44);

      // Verify two distinct offers exist for the game
      const allOffers = offerRepo.getOffersForGame(gameId);
      expect(allOffers).toHaveLength(2);
      const editions = allOffers.map(o => o.editionKey).sort();
      expect(editions).toEqual(['deluxe', 'standard']);

      // Verify Deluxe does not consider €36.29 as previous price to avoid false PRICE_INCREASE
      expect(deluxeOffer.priceEvent).not.toBe('PRICE_INCREASE');
      expect(deluxeOffer.priceEvent).toBe('NEW_OFFER');

      // Step 3: Repeated observation of Standard Edition does not treat Deluxe as previous price
      const standardOffer2 = offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 36.29,
        originalPriceEur: 59.99,
        dealUrl: 'https://indiegala.com/standard',
        sourceCode: 'nexarda',
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'CONFIDENT',
      });

      // Standard offer price did not change -> MUST NOT generate EXTREME_DROP or MAJOR_DROP from Deluxe €54.44!
      expect(standardOffer2.priceEvent).toBe('NONE');
    });

    it('detects genuine price drop within the same edition stream', () => {
      // Ingest Deluxe at €54.44
      offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 54.44,
        originalPriceEur: 79.99,
        dealUrl: 'https://indiegala.com/deluxe',
        sourceCode: 'nexarda',
        editionKey: 'deluxe',
        editionName: 'Deluxe Edition',
        identityConfidence: 'CONFIDENT',
      });

      // Deluxe goes on sale from €54.44 to €39.99 (a €14.45 drop >= €5.00 threshold) -> MAJOR_DROP
      const discountedDeluxe = offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 39.99,
        originalPriceEur: 79.99,
        dealUrl: 'https://indiegala.com/deluxe',
        sourceCode: 'nexarda',
        editionKey: 'deluxe',
        editionName: 'Deluxe Edition',
        identityConfidence: 'CONFIDENT',
      });

      expect(discountedDeluxe.priceEvent).toBe('MAJOR_DROP');
    });

    it('forces price_event to NONE when identity_confidence is AMBIGUOUS', () => {
      const ambiguousOffer = offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 19.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://indiegala.com/unknown',
        sourceCode: 'nexarda',
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'AMBIGUOUS',
      });

      expect(ambiguousOffer.identityConfidence).toBe('AMBIGUOUS');
      expect(ambiguousOffer.priceEvent).toBe('NONE');
    });

    it('prioritizes standard edition when computing best deal for game', () => {
      // Standard at €36.29
      offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 36.29,
        originalPriceEur: 59.99,
        dealUrl: 'https://indiegala.com/standard',
        sourceCode: 'nexarda',
        editionKey: 'standard',
        editionName: 'Standard Edition',
        identityConfidence: 'CONFIDENT',
      });

      // Deluxe at €34.99 (even if Deluxe happens to be cheaper during a bundle sale)
      offerRepo.upsertOffer({
        gameId,
        merchantId,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 34.99,
        originalPriceEur: 79.99,
        dealUrl: 'https://indiegala.com/deluxe',
        sourceCode: 'nexarda',
        editionKey: 'deluxe',
        editionName: 'Deluxe Edition',
        identityConfidence: 'CONFIDENT',
      });

      const allOffers = offerRepo.getOffersForGame(gameId);
      const bestDeal = allOffers.find(o => o.isBestDeal);
      expect(bestDeal).toBeDefined();
      expect(bestDeal!.editionKey).toBe('standard');
    });
  });
});
