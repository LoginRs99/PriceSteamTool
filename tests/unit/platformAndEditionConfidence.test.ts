import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeEdition } from '../../src/server/domain/edition.js';
import { normalizeActivationPlatform } from '../../src/server/domain/platform.js';
import { getDb, offerRepo, gameRepo, merchantRepo } from '../../src/server/db/index.js';
import { GGDealsSourceAdapter } from '../../src/server/sources/ggdeals.js';
import { SuperDuperBundleSourceAdapter } from '../../src/server/sources/superduperbundle.js';

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

describe('Final Hardening Suite: Edition Confidence, DRM Identity & Marketplace Churn', () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
  });

  // ==========================================
  // 1. GG.deals & SuperDuperBundle Edition Confidence (BLOCKER)
  // ==========================================
  describe('1. GG.deals & SuperDuperBundle Edition Confidence & Upstream Semantics', () => {
    it('GG.deals emits AMBIGUOUS when edition metadata is absent in payload and title', () => {
      const res = normalizeEdition(null, 'Cyberpunk 2077', 'ggdeals');
      expect(res.editionKey).toBe('standard');
      expect(res.identityConfidence).toBe('AMBIGUOUS');
      expect(res.editionName).toContain('Unverified');
    });

    it('GG.deals emits CONFIDENT when title or URL contains explicit edition indicators', () => {
      const resDeluxe = normalizeEdition(null, 'Cyberpunk 2077: Deluxe Edition', 'ggdeals');
      expect(resDeluxe.editionKey).toBe('deluxe');
      expect(resDeluxe.identityConfidence).toBe('CONFIDENT');

      const resPack = normalizeEdition(null, 'https://gg.deals/pack/the-witcher-3-wild-hunt-complete-edition/', 'ggdeals');
      expect(resPack.editionKey).toBe('complete');
      expect(resPack.identityConfidence).toBe('CONFIDENT');
    });

    it('SuperDuperBundle emits AMBIGUOUS when offer lacks explicit edition metadata', () => {
      const res = normalizeEdition(null, 'Max Payne', 'superduperbundle');
      expect(res.editionKey).toBe('standard');
      expect(res.identityConfidence).toBe('AMBIGUOUS');
    });

    it('SuperDuperBundle emits CONFIDENT when title contains explicit Deluxe/Ultimate keyword', () => {
      const res = normalizeEdition(null, 'Control Ultimate Edition', 'superduperbundle');
      expect(res.editionKey).toBe('ultimate');
      expect(res.identityConfidence).toBe('CONFIDENT');
    });

    it('Steam Storefront emits CONFIDENT standard due to canonical base App ID package architecture', () => {
      const res = normalizeEdition(null, 'Half-Life 2', 'steam');
      expect(res.editionKey).toBe('standard');
      expect(res.identityConfidence).toBe('CONFIDENT');
      expect(res.editionName).toBe('Standard Edition');
    });

    it('ITAD emits CONFIDENT standard due to canonical base game entity resolution', () => {
      const res = normalizeEdition(null, 'Portal 2', 'itad');
      expect(res.editionKey).toBe('standard');
      expect(res.identityConfidence).toBe('CONFIDENT');
      expect(res.editionName).toBe('Standard Edition');
    });

    it('Ambiguous edition offer is stored as valid in offers but suppressed from price drop events', () => {
      const game = gameRepo.upsert({
        steamAppId: 1091500,
        title: 'Cyberpunk 2077',
        slug: 'cyberpunk-2077',
        basePriceEur: 59.99
      });

      const merchant = merchantRepo.getOrCreate('ggdeals_keyshops', 'GG.deals (Keyshops)', false);

      const offer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 24.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://gg.deals/game/cyberpunk-2077/',
        editionKey: 'standard',
        editionName: 'Standard Edition (Unverified)',
        identityConfidence: 'AMBIGUOUS'
      });

      // 1. Offer must remain valid and visible in the active catalog
      expect(offer.isValid).toBe(true);
      expect(offer.identityConfidence).toBe('AMBIGUOUS');

      // 2. But price event must be NONE (ambiguous identity cannot trigger fresh drop events)
      expect(offer.priceEvent).toBe('NONE');

      // 3. Game offers query includes it
      const gameOffers = offerRepo.getOffersForGame(game.id);
      expect(gameOffers.length).toBe(1);
      expect(gameOffers[0].identityConfidence).toBe('AMBIGUOUS');
    });
  });

  // ==========================================
  // 2. DRM / Activation Platform Identity Collision Prevention
  // ==========================================
  describe('2. DRM & Activation Platform Identity Collision Prevention', () => {
    it('normalizes activation platforms correctly across various sources and DRM tags', () => {
      expect(normalizeActivationPlatform('Steam', null, 'Fanatical', 'itad')).toEqual({
        platform: 'steam',
        platformName: 'Steam',
        isSteam: true,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform('Epic Games', null, 'Humble Store', 'itad')).toEqual({
        platform: 'epic',
        platformName: 'Epic Games',
        isSteam: false,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform('GOG.com', null, 'GOG Store', 'itad')).toEqual({
        platform: 'gog',
        platformName: 'GOG.com',
        isSteam: false,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform(null, 'Ubisoft Connect', 'GreenManGaming', 'nexarda')).toEqual({
        platform: 'ubisoft',
        platformName: 'Ubisoft Connect',
        isSteam: false,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform(null, 'Origin', 'EA Store', 'cheapshark')).toEqual({
        platform: 'ea',
        platformName: 'EA App',
        isSteam: false,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform(null, 'Rockstar', 'Kinguin', 'nexarda')).toEqual({
        platform: 'rockstar',
        platformName: 'Rockstar Games Launcher',
        isSteam: false,
        confidence: 'CONFIDENT'
      });

      expect(normalizeActivationPlatform(null, null, null, 'unknown_source')).toEqual({
        platform: 'unknown',
        platformName: 'Unknown Platform',
        isSteam: false,
        confidence: 'AMBIGUOUS'
      });
    });

    it('allows same retailer to sell Steam, Epic, and GOG keys simultaneously without collision', () => {
      const game = gameRepo.upsert({
        steamAppId: 1086940,
        title: "Baldur's Gate 3",
        slug: 'baldurs-gate-3',
        basePriceEur: 59.99
      });

      const gmg = merchantRepo.getOrCreate('greenmangaming', 'GreenManGaming', true);

      // 1. Ingest Steam Key from GMG at €49.99
      const steamOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 49.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://greenmangaming.com/bg3-steam',
        editionKey: 'standard',
        activationPlatform: 'steam'
      });

      // 2. Ingest GOG Key from GMG at €44.99
      const gogOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 44.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://greenmangaming.com/bg3-gog',
        editionKey: 'standard',
        activationPlatform: 'gog'
      });

      // 3. Ingest Epic Key from GMG at €39.99
      const epicOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 39.99,
        originalPriceEur: 59.99,
        dealUrl: 'https://greenmangaming.com/bg3-epic',
        editionKey: 'standard',
        activationPlatform: 'epic'
      });

      // Verification: All 3 offers coexist with distinct IDs
      expect(steamOffer.id).not.toBe(gogOffer.id);
      expect(steamOffer.id).not.toBe(epicOffer.id);
      expect(gogOffer.id).not.toBe(epicOffer.id);

      // Verify all 3 offers are retrieved
      const allOffers = offerRepo.getOffersForGame(game.id);
      expect(allOffers.length).toBe(3);

      const platforms = allOffers.map(o => o.activationPlatform);
      expect(platforms).toContain('steam');
      expect(platforms).toContain('gog');
      expect(platforms).toContain('epic');
    });

    it('maintains independent price history streams per platform to prevent cross-platform ping-pong', () => {
      const game = gameRepo.upsert({
        steamAppId: 1086940,
        title: "Baldur's Gate 3",
        slug: 'baldurs-gate-3',
        basePriceEur: 59.99
      });

      const gmg = merchantRepo.getOrCreate('greenmangaming', 'GreenManGaming', true);

      // Record Steam offer €50
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 50.00,
        dealUrl: 'https://greenmangaming.com/bg3-steam',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'itad'
      });

      // Record Epic offer €35
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 35.00,
        dealUrl: 'https://greenmangaming.com/bg3-epic',
        editionKey: 'standard',
        activationPlatform: 'epic',
        sourceCode: 'itad'
      });

      // Record Steam offer update €48 (-€2 drop on Steam)
      const steamUpdate = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gmg.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 48.00,
        dealUrl: 'https://greenmangaming.com/bg3-steam',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'itad'
      });

      // The Steam update evaluates against previous Steam €50, NOT against Epic €35
      // €50 -> €48 is a 4% drop (-€2), below 5% noise threshold -> NONE
      // (If it evaluated against Epic €35, it would have falsely triggered PRICE_INCREASE from €35 -> €48!)
      expect(steamUpdate.priceEvent).toBe('NONE');
    });
  });

  // ==========================================
  // 3. Deal Discovery & Best Deal Preservation
  // ==========================================
  describe('3. Deal Discovery & Best Deal Selection Preservation', () => {
    it('prefers Standard Edition and Steam platform for Best Deal while keeping all deals accessible', () => {
      const game = gameRepo.upsert({
        steamAppId: 271590,
        title: 'Grand Theft Auto V',
        slug: 'grand-theft-auto-v',
        basePriceEur: 29.99
      });

      const steam = merchantRepo.getOrCreate('steam', 'Steam Store', true);
      const fanatical = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

      // Offer 1: Steam Key Standard €14.99
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: steam.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        dealUrl: 'https://store.steampowered.com/app/271590/',
        editionKey: 'standard',
        activationPlatform: 'steam'
      });

      // Offer 2: Epic Key Standard €14.99 (same price)
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: fanatical.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        dealUrl: 'https://fanatical.com/gta-v-epic',
        editionKey: 'standard',
        activationPlatform: 'epic'
      });

      offerRepo.recomputeBestDealForGame(game.id);

      const allOffers = offerRepo.getOffersForGame(game.id);
      const bestOffer = allOffers.find(o => o.isBestDeal);

      // Steam platform wins the tie-breaker for PriceSteamTool's primary best deal
      expect(bestOffer).toBeDefined();
      expect(bestOffer?.activationPlatform).toBe('steam');
      expect(bestOffer?.merchantCode).toBe('steam');
    });
  });
});
