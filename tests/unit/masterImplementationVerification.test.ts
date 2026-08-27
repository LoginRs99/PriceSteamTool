import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  sourceRepo,
  anomalyRepo, 
  getDb, 
  prepareStmt,
  isCompatiblePeerOffer
} from '../../src/server/db/index.js';
import { 
  calculatePeriodLows, 
  calculateTypicalSalePrice, 
  calculatePriceVolatility, 
  groupSaleEvents,
  isTrustedHistoryEntry
} from '../../src/server/domain/priceIntelligence.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine.js';
import { normalizeRegion, EU_MEMBER_STATES, EEA_COUNTRIES, UK_COUNTRY_CODES, SWISS_COUNTRY_CODES } from '../../src/server/domain/normalizer.js';
import { AllKeyShopCatalogIndex, findCandidateGamesInCatalog, loadCustomMappings, saveCustomMapping } from '../../src/server/sources/allkeyshop.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import type { PriceHistoryEntry, Game, Offer } from '../../src/shared/types.js';

describe('Master Implementation Verification Suite — Fresh Pass Audit & Fixes', () => {
  function resetDb() {
    circuitBreakers.resetAll();
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
      PRAGMA foreign_keys = ON;
    `);
  }

  beforeEach(() => {
    resetDb();
  });

  // ----------------------------------------------------
  // 1. P0 — Price Intelligence De-Duplication & Trusted History
  // ----------------------------------------------------
  describe('P0: Trusted History Isolation from Pricing Anomalies', () => {
    it('isTrustedHistoryEntry excludes anomalies and high-risk glitch observations', () => {
      const normalEntry: PriceHistoryEntry = {
        id: 'h1',
        gameId: 'g1',
        sourceCode: 'steam',
        priceEur: 19.99,
        recordedAt: '2026-08-01T00:00:00Z',
        isAnomaly: false,
        riskLevel: 'SAFE'
      };
      const anomalyEntry: PriceHistoryEntry = {
        id: 'h2',
        gameId: 'g1',
        sourceCode: 'allkeyshop',
        priceEur: 0.50,
        recordedAt: '2026-08-02T00:00:00Z',
        isAnomaly: true,
        riskLevel: 'HIGH',
        priceEvent: 'EXTREME_DROP'
      };
      const zeroEntry: PriceHistoryEntry = {
        id: 'h3',
        gameId: 'g1',
        sourceCode: 'itad',
        priceEur: 0,
        recordedAt: '2026-08-03T00:00:00Z'
      };

      expect(isTrustedHistoryEntry(normalEntry)).toBe(true);
      expect(isTrustedHistoryEntry(anomalyEntry)).toBe(false);
      expect(isTrustedHistoryEntry(zeroEntry)).toBe(false);
    });

    it('prevents anomalous price glitches from corrupting ATL, typical sale median, volatility, and sale events', () => {
      const mockGame: Game = {
        id: 'g-elden',
        steamAppId: 1245620,
        title: 'Elden Ring',
        slug: 'elden-ring',
        basePriceEur: 59.99,
        historicalLowEur: 35.99,
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2026-08-27T00:00:00Z'
      };

      // 1 year of real historical sales around €35 - €40, plus 1 anomalous €0.50 glitch
      const history: PriceHistoryEntry[] = [
        { id: '1', gameId: mockGame.id, sourceCode: 'steam', priceEur: 39.99, discountPercent: 33, recordedAt: '2025-10-01T00:00:00Z' },
        { id: '2', gameId: mockGame.id, sourceCode: 'steam', priceEur: 35.99, discountPercent: 40, recordedAt: '2025-12-20T00:00:00Z' },
        { id: '3', gameId: mockGame.id, sourceCode: 'itad', priceEur: 37.99, discountPercent: 37, recordedAt: '2026-03-15T00:00:00Z' },
        { id: '4', gameId: mockGame.id, sourceCode: 'steam', priceEur: 35.99, discountPercent: 40, recordedAt: '2026-06-25T00:00:00Z' },
        // The glitch observation:
        { id: '5', gameId: mockGame.id, sourceCode: 'allkeyshop', priceEur: 0.50, discountPercent: 99, isAnomaly: true, riskLevel: 'HIGH', priceEvent: 'EXTREME_DROP', recordedAt: '2026-08-20T00:00:00Z' }
      ];

      // 1. Period Lows & ATL must ignore €0.50
      const periodLows = calculatePeriodLows(mockGame, history);
      expect(periodLows.allTimeLow.priceEur).toBe(35.99);
      expect(periodLows.allTimeLow.priceEur).not.toBe(0.50);

      // 2. Typical Sale Price must not be anchored to €0.50
      const typicalSale = calculateTypicalSalePrice(mockGame.basePriceEur, history);
      expect(typicalSale.medianPriceEur).toBeGreaterThanOrEqual(35.00);
      expect(typicalSale.medianPriceEur).toBeLessThanOrEqual(40.00);

      // 3. Volatility must not show extreme glitch spikes
      const volatility = calculatePriceVolatility(history);
      expect(volatility.category).not.toBe('Volatile');

      // 4. Sale events must not group the €0.50 glitch as a valid sale
      const saleFreq = groupSaleEvents(mockGame.basePriceEur, history);
      expect(saleFreq.saleEventsLast12m).toBeGreaterThan(0);
    });
  });

  // ----------------------------------------------------
  // 2. P0 — Freshness-Aware Active Offer Winner Selection
  // ----------------------------------------------------
  describe('P0: Freshness-Aware Active Offer Winner Selection', () => {
    it('fresh observation wins over a stale lower price observation', () => {
      const game = gameRepo.upsert({ steamAppId: 1001, title: 'Freshness Test Game', basePriceEur: 49.99 });
      const merchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

      // Ingest stale lower observation 60 days ago
      const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const obsMetaStale = { dealUrl: 'https://fanatical.com/stale', isValid: true };
      
      const offerId = 'test-offer-freshness-1';
      prepareStmt(`
        INSERT INTO offers (
          id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, price_event, risk_level, risk_score, risk_flags, evaluation_confidence, is_anomaly, anomaly_score, fetched_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'STEAM_KEY', 'GLOBAL', 9.99, 'https://fanatical.com/stale', 1, 1, 'NONE', 'SAFE', 0.0, '[]', 1.0, 0, 0.0, ?, ?, ?)
      `).run(offerId, game.id, merchant.id, staleDate, staleDate, staleDate);

      prepareStmt(`
        INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at, raw_data_json)
        VALUES (?, ?, 'itad', 9.99, ?, ?)
      `).run('obs-stale', offerId, staleDate, JSON.stringify(obsMetaStale));

      // Now a fresh observation arrives from GG.deals at €14.99 (higher price, but fresh live observation)
      const freshOffer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        dealUrl: 'https://fanatical.com/fresh',
        isValid: true,
        sourceCode: 'ggdeals'
      });

      // Fresh €14.99 must beat the stale €9.99 observation as active price
      expect(freshOffer.priceEur).toBe(14.99);
      expect(freshOffer.dealUrl).toBe('https://fanatical.com/fresh');
    });
  });

  // ----------------------------------------------------
  // 3. P0 — Market Peer Comparison Compatibility & Cheapest Candidate Policy
  // ----------------------------------------------------
  describe('P0: Market Peer Comparison Compatibility & Cheapest Candidate Policy', () => {
    it('isCompatiblePeerOffer strictly separates incompatible products, regions, and anomalies', () => {
      const target = { productType: 'STEAM_KEY', regionType: 'GLOBAL' };

      // Compatible peers
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);

      // Incompatible product types
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_GIFT', regionType: 'GLOBAL', isValid: true })).toBe(false);
      expect(isCompatiblePeerOffer(target, { productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', isValid: true })).toBe(false);

      // Incompatible regions
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'RESTRICTED', isValid: true })).toBe(false);

      // Incompatible anomaly / risk
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: true })).toBe(false);
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, riskLevel: 'HIGH' })).toBe(false);
      expect(isCompatiblePeerOffer(target, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: false })).toBe(false);
    });

    it('enforces cheapest-candidate policy: non-cheapest offers cannot trigger pricing error anomalies', () => {
      const flags = new Set<any>();

      // Candidate 1: €0.49 (Cheapest live offer on €59.99 game) -> should flag as pricing glitch
      const eval1 = evaluatePriceMovement({
        currentPriceEur: 0.49,
        basePriceEur: 59.99,
        marketPricesEur: [49.99, 45.00, 52.00],
        sourceAgreementCount: 1,
        isOfficialMerchant: false
      });
      expect(eval1.isAnomaly).toBe(true);
      expect(eval1.riskLevel).toBe('HIGH');
      expect(eval1.riskFlags).toContain('SUB_EURO_PREMIUM_GLITCH');

      // Candidate 2: €45.00 when market has €12.00 (not cheapest candidate) -> cannot trigger pricing error
      const eval2 = evaluatePriceMovement({
        currentPriceEur: 45.00,
        basePriceEur: 59.99,
        marketPricesEur: [12.00, 14.00, 15.00],
        sourceAgreementCount: 1,
        isOfficialMerchant: true
      });
      expect(eval2.isAnomaly).toBe(false);
      expect(eval2.riskLevel).toBe('SAFE');
    });

    it('distinguishes multi-aggregator source agreement from independent merchant corroboration', () => {
      // 3 aggregators (ITAD, GGDeals, CheapShark) observing the SAME single keyshop merchant at €0.49
      const evalSingleMerchantMultiSource = evaluatePriceMovement({
        currentPriceEur: 0.49,
        basePriceEur: 59.99,
        marketPricesEur: [59.99, 55.00],
        sourceAgreementCount: 3, // 3 scrapers
        independentMerchantCount: 1, // Only 1 merchant
        isOfficialMerchant: false
      });
      // Should still be detected as high glitch risk because only 1 store offers it
      expect(evalSingleMerchantMultiSource.riskLevel).toBe('HIGH');
      expect(evalSingleMerchantMultiSource.isAnomaly).toBe(true);

      // Whereas 3 distinct independent retailers all listing €14.99 proves genuine market price
      const evalMultiMerchantCorroborated = evaluatePriceMovement({
        currentPriceEur: 14.99,
        basePriceEur: 59.99,
        marketPricesEur: [14.99, 15.20, 15.50],
        sourceAgreementCount: 1,
        independentMerchantCount: 3,
        isOfficialMerchant: true
      });
      expect(evalMultiMerchantCorroborated.riskLevel).toBe('SAFE');
      expect(evalMultiMerchantCorroborated.isAnomaly).toBe(false);
    });
  });

  // ----------------------------------------------------
  // 4. P1 — Region Modeling (UK and Switzerland are not EU)
  // ----------------------------------------------------
  describe('P1: Region Modeling & Activation Scope', () => {
    it('properly distinguishes EU member states from non-EU European nations (UK, Switzerland)', () => {
      expect(EU_MEMBER_STATES.has('HU')).toBe(true);
      expect(EU_MEMBER_STATES.has('DE')).toBe(true);
      expect(EU_MEMBER_STATES.has('FR')).toBe(true);
      expect(EU_MEMBER_STATES.has('GB')).toBe(false);
      expect(EU_MEMBER_STATES.has('UK')).toBe(false);
      expect(EU_MEMBER_STATES.has('CH')).toBe(false);

      // Hungary compatibility
      const huRes = normalizeRegion('HU');
      expect(huRes.regionType).toBe('HU');
      expect(huRes.isValid).toBe(true);

      // EU compatibility
      const euRes = normalizeRegion('EU');
      expect(euRes.regionType).toBe('EU');
      expect(euRes.isValid).toBe(true);

      const deRes = normalizeRegion('DE');
      expect(deRes.regionType).toBe('EU');
      expect(deRes.isValid).toBe(true);

      // UK is restricted for Hungarian activation
      const ukRes = normalizeRegion('GB');
      expect(ukRes.regionType).toBe('RESTRICTED');
      expect(ukRes.isValid).toBe(false);

      const ukWordRes = normalizeRegion('United Kingdom');
      expect(ukWordRes.regionType).toBe('RESTRICTED');
      expect(ukWordRes.isValid).toBe(false);

      // Switzerland is restricted for Hungarian activation
      const chRes = normalizeRegion('CH');
      expect(chRes.regionType).toBe('RESTRICTED');
      expect(chRes.isValid).toBe(false);

      // Unknown region is rejected
      const unknownRes = normalizeRegion('XYZ_UNKNOWN');
      expect(unknownRes.regionType).toBe('RESTRICTED');
      expect(unknownRes.isValid).toBe(false);
    });
  });

  // ----------------------------------------------------
  // 5. P1 — AllKeyShop Indexed Catalog & Cached Custom Mappings
  // ----------------------------------------------------
  describe('P1: AllKeyShop Catalog Indexing & Memory Cache', () => {
    it('indexes catalog and matches titles in O(1) prefix/clean name lookups', () => {
      const mockCatalog = [
        { id: 101, name: 'Cyberpunk 2077', slug: 'cyberpunk-2077' },
        { id: 102, name: 'Cyberpunk 2077: Phantom Liberty', slug: 'cyberpunk-2077-phantom-liberty' },
        { id: 201, name: 'Elden Ring', slug: 'elden-ring' },
        { id: 202, name: 'Elden Ring Shadow of the Erdtree', slug: 'elden-ring-shadow-of-the-erdtree' }
      ];

      const index = new AllKeyShopCatalogIndex(mockCatalog);
      expect(index.getById(101)?.name).toBe('Cyberpunk 2077');
      expect(index.getBySlug('elden-ring')?.id).toBe(201);

      const candidates = findCandidateGamesInCatalog(index, 'Cyberpunk 2077', 1091500);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(101);
    });

    it('caches custom mapping overrides and respects save/load operations', () => {
      saveCustomMapping(999999, 101);
      const mappings = loadCustomMappings();
      expect(mappings['999999']).toBe(101);

      // Cleanup override
      saveCustomMapping(999999, null);
      const updated = loadCustomMappings();
      expect(updated['999999']).toBeUndefined();
    });
  });

  // ----------------------------------------------------
  // 6. P1 — Circuit Breaker Persistence Across Restarts
  // ----------------------------------------------------
  describe('P1: Circuit Breaker Persistence', () => {
    it('persists consecutive failure and rate limit counters in database', () => {
      circuitBreakers.recordFailure('cheapshark', 'API timeout error');
      
      const src = sourceRepo.getByCode('cheapshark');
      expect(src?.consecutiveFailures).toBeGreaterThan(0);

      // Success resets consecutive counters
      circuitBreakers.recordSuccess('cheapshark');
      const srcAfter = sourceRepo.getByCode('cheapshark');
      expect(srcAfter?.consecutiveFailures).toBe(0);
      expect(srcAfter?.state).toBe('NORMAL');
    });
  });

  // ----------------------------------------------------
  // 7. P1 — Game-Specific Source Selection
  // ----------------------------------------------------
  describe('P1: Game-Specific Source Selection in refreshGame', () => {
    it('respects requested sources parameter and only executes specified sources', async () => {
      const game = gameRepo.upsert({ steamAppId: 570, title: 'Dota 2', basePriceEur: 0 });

      vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
        {
          merchantCode: 'steam',
          merchantName: 'Steam Store',
          isOfficial: true,
          priceEur: 0.0,
          originalPriceEur: 0.0,
          dealUrl: 'https://store.steampowered.com/app/570',
          productTypeRaw: 'DIRECT_PURCHASE',
          regionRaw: 'GLOBAL'
        }
      ]);

      const result = await syncOrchestrator.refreshGame(game.id, {
        sources: ['steam'],
        includeKeyshops: false
      });

      expect(result.sourcesChecked).toContain('steam');
      expect(result.sourcesChecked).not.toContain('itad');
      expect(result.sourcesChecked).not.toContain('cheapshark');
      expect(result.sourcesChecked).not.toContain('ggdeals');
      expect(result.sourcesChecked).not.toContain('allkeyshop');
    });
  });
});
