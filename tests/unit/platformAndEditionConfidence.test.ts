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

  // ==========================================
  // 4. Regional Price History Isolation
  // ==========================================
  describe('4. Regional Price History Stream Isolation', () => {
    it('EU and Global offers from same merchant maintain independent price streams and cannot contaminate each other', () => {
      const game = gameRepo.upsert({
        steamAppId: 1086940,
        title: "Baldur's Gate 3 (Regional Test)",
        slug: 'baldurs-gate-3-reg',
        basePriceEur: 59.99
      });

      const gamesplanet = merchantRepo.getOrCreate('gamesplanet', 'Gamesplanet', true);

      // 1. Record Gamesplanet EU offer at €28.49
      const euOffer1 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gamesplanet.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 28.49,
        dealUrl: 'https://gamesplanet.com/bg3-eu',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'nexarda'
      });
      expect(euOffer1.priceEvent).toBe('NEW_OFFER');

      // 2. Record Gamesplanet GLOBAL offer at €6.21
      const globalOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gamesplanet.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 22.00,
        dealUrl: 'https://gamesplanet.com/bg3-global',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'cheapshark'
      });
      // Global is a new offer stream for GLOBAL region, evaluated against empty Global history
      expect(globalOffer.priceEvent).toBe('NEW_OFFER');

      // 3. Update Gamesplanet EU offer to €28.00 (a minor drop from €28.49, 1.7% drop -> NONE)
      const euOffer2 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: gamesplanet.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 28.00,
        dealUrl: 'https://gamesplanet.com/bg3-eu',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'nexarda'
      });

      // The EU update evaluates against previous EU €28.49, NOT against Global €6.21
      // €28.49 -> €28.00 is a 1.7% drop (-€0.49), below 5% noise threshold -> NONE
      // (If it had contaminated with Global €6.21, €6.21 -> €28.00 would have falsely triggered PRICE_INCREASE!)
      expect(euOffer2.priceEvent).toBe('NONE');

      // Verify both EU and Global price histories exist and are tagged with their respective region_type
      const history = offerRepo.getPriceHistory(game.id);
      expect(history.length).toBe(3);

      const euHist = history.filter(h => h.regionType === 'EU');
      const globalHist = history.filter(h => h.regionType === 'GLOBAL');
      expect(euHist.length).toBe(2);
      expect(globalHist.length).toBe(1);
      expect(globalHist[0].priceEur).toBe(22.00);
    });

    it('US and EU offers coexist with distinct region types and do not trigger cross-regional price jumps', () => {
      const game = gameRepo.upsert({
        steamAppId: 1091500,
        title: 'Cyberpunk 2077 (US/EU Regional)',
        slug: 'cyberpunk-us-eu',
        basePriceEur: 59.99
      });

      const g2a = merchantRepo.getOrCreate('g2a', 'G2A', false);

      // US Key at €18.20
      const usOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: g2a.id,
        productType: 'STEAM_KEY',
        regionType: 'US',
        priceEur: 18.20,
        dealUrl: 'https://g2a.com/cp2077-us',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'nexarda'
      });
      expect(usOffer.priceEvent).toBe('NEW_OFFER');

      // EU Key at €22.00
      const euOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: g2a.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 22.00,
        dealUrl: 'https://g2a.com/cp2077-eu',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'nexarda'
      });
      expect(euOffer.priceEvent).toBe('NEW_OFFER');

      const allOffers = offerRepo.getOffersForGame(game.id);
      expect(allOffers.length).toBe(2);
      const regionTypes = allOffers.map(o => o.regionType);
      expect(regionTypes).toContain('US');
      expect(regionTypes).toContain('EU');
    });

    it('legacy price_history records marked as region_type = unknown never contaminate verified GLOBAL or EU streams', () => {
      const game = gameRepo.upsert({
        steamAppId: 1234567,
        title: 'Legacy Regional Isolation Game',
        slug: 'legacy-reg-game',
        basePriceEur: 49.99
      });

      const merchant = merchantRepo.getOrCreate('gamesplanet', 'Gamesplanet', true);

      // Seed a legacy contaminated historical record with region_type = 'unknown' (e.g. historical €40.00)
      getDb().prepare(`
        INSERT INTO price_history (
          id, game_id, merchant_id, source_code, price_eur, price_event,
          edition_key, activation_platform, region_type, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'legacy-hist-1',
        game.id,
        merchant.id,
        'nexarda',
        40.00,
        'NONE',
        'standard',
        'steam',
        'unknown',
        new Date(Date.now() - 86400000).toISOString()
      );

      // Now upsert a verified GLOBAL offer at €10.00
      // If contaminated with the €40.00 unknown record, it would trigger a massive drop (-75%).
      // Because regional streams are strictly isolated, it sees no previous GLOBAL history -> NEW_OFFER!
      const newGlobalOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 10.00,
        dealUrl: 'https://gamesplanet.com/bg3-global',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'cheapshark'
      });
      expect(newGlobalOffer.priceEvent).toBe('NEW_OFFER');

      // Now upsert a verified EU offer at €28.00
      // Similarly sees no previous EU history -> NEW_OFFER!
      const newEuOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'EU',
        priceEur: 28.00,
        dealUrl: 'https://gamesplanet.com/bg3-eu',
        editionKey: 'standard',
        activationPlatform: 'steam',
        sourceCode: 'nexarda'
      });
      expect(newEuOffer.priceEvent).toBe('NEW_OFFER');
    });
  });
});
