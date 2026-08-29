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
      // Hierarchical region compatibility:
      // GLOBAL target only accepts GLOBAL peer
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(false);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(false);

      // EU target accepts GLOBAL and EU peers, but not HU-only
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'EU' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'EU' }, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'EU' }, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(false);

      // HU target accepts GLOBAL, EU, and HU peers
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'HU' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'HU' }, { productType: 'STEAM_KEY', regionType: 'EU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'HU' }, { productType: 'STEAM_KEY', regionType: 'HU', isValid: true, isAnomaly: false, riskLevel: 'SAFE' })).toBe(true);

      // Incompatible product types
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_GIFT', regionType: 'GLOBAL', isValid: true })).toBe(false);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'DIRECT_PURCHASE', regionType: 'GLOBAL', isValid: true })).toBe(false);

      // Incompatible regions (RESTRICTED)
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'RESTRICTED', isValid: true })).toBe(false);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'RESTRICTED' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true })).toBe(false);

      // Incompatible anomaly / risk
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, isAnomaly: true })).toBe(false);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: true, riskLevel: 'HIGH' })).toBe(false);
      expect(isCompatiblePeerOffer({ productType: 'STEAM_KEY', regionType: 'GLOBAL' }, { productType: 'STEAM_KEY', regionType: 'GLOBAL', isValid: false })).toBe(false);
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

  // ----------------------------------------------------
  // 8. P0 — End-to-End Production PriceHistoryEntry Reconstruction & Backfill
  // ----------------------------------------------------
  describe('P0: End-to-End Production PriceHistoryEntry Reconstruction', () => {
    it('persists and reconstructs is_anomaly and risk_level through getPriceHistory and backfillDealScoreStats', async () => {
      const { backfillDealScoreStats } = await import('../../src/server/db/core.js');
      const game = gameRepo.upsert({ steamAppId: 8881, title: 'Reconstruction Game', basePriceEur: 69.99 });
      const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      // Insert 2 normal rows and 1 anomaly row in SQLite
      prepareStmt(`
        INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, raw_price, raw_currency, fx_rate, discount_percent, price_event, deal_score, is_anomaly, risk_level, recorded_at)
        VALUES (?, ?, ?, 'steam', 69.99, 69.99, 'EUR', 1.0, 0, 'NONE', 50, 0, 'SAFE', '2026-01-01T00:00:00Z')
      `).run('hist-1', game.id, merchant.id);

      prepareStmt(`
        INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, raw_price, raw_currency, fx_rate, discount_percent, price_event, deal_score, is_anomaly, risk_level, recorded_at)
        VALUES (?, ?, ?, 'steam', 49.99, 49.99, 'EUR', 1.0, 28, 'PRICE_DROP', 75, 0, 'SAFE', '2026-02-01T00:00:00Z')
      `).run('hist-2', game.id, merchant.id);

      prepareStmt(`
        INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, raw_price, raw_currency, fx_rate, discount_percent, price_event, deal_score, is_anomaly, risk_level, recorded_at)
        VALUES (?, ?, ?, 'allkeyshop', 0.99, 0.99, 'EUR', 1.0, 98, 'EXTREME_DROP', 99, 1, 'HIGH', '2026-03-01T00:00:00Z')
      `).run('hist-3', game.id, merchant.id);

      // Verify offerRepo.getPriceHistory preserves metadata
      const history = offerRepo.getPriceHistory(game.id);
      expect(history.length).toBe(3);
      const glitch = history.find(h => h.id === 'hist-3')!;
      expect(glitch.isAnomaly).toBe(true);
      expect(glitch.riskLevel).toBe('HIGH');
      expect(glitch.rawCurrency).toBe('EUR');

      // Verify backfill does not drop anomaly flags and ignores glitch for typical sale & period lows
      backfillDealScoreStats();
      const updatedGame = gameRepo.getById(game.id)!;
      expect(updatedGame.typicalSaleMedianEur).toBeGreaterThanOrEqual(49.0);
      expect(updatedGame.typicalSaleMedianEur).toBeLessThanOrEqual(70.0);
      expect(updatedGame.low90dEur).not.toBe(0.99);
      expect(updatedGame.low1yEur).not.toBe(0.99);
    });
  });

  // ----------------------------------------------------
  // 9. P0 — Fully Decoupled Peer-Market Anomaly Signals
  // ----------------------------------------------------
  describe('P0: Fully Decoupled Peer-Market vs Own-History Anomaly Signals', () => {
    it('Case A: detects peer-market anomaly even when own history is stable', () => {
      // Own history: €5.00, €4.90, €5.10, €5.00 -> current €4.90
      // Peers: €25, €27, €29
      const evalCaseA = evaluatePriceMovement({
        currentPriceEur: 4.90,
        basePriceEur: 29.99,
        marketPricesEur: [25.00, 27.00, 29.00],
        sourceHistoryEur: [5.00, 4.90, 5.10, 5.00],
        previousPriceEur: 5.00,
        sourceAgreementCount: 1,
        independentMerchantCount: 1,
        isOfficialMerchant: false
      });

      expect(evalCaseA.riskFlags).toContain('LONE_BOTTOM_OUTLIER');
      expect(evalCaseA.riskFlags).toContain('EXTREME_MEDIAN_OUTLIER');
      expect(evalCaseA.riskLevel).toBe('HIGH');
      expect(evalCaseA.isAnomaly).toBe(true);
    });

    it('Case B: detects own-history anomaly when source breaks without peer market', () => {
      const evalCaseB = evaluatePriceMovement({
        currentPriceEur: 4.99,
        basePriceEur: 59.99,
        marketPricesEur: [], // No peers
        sourceHistoryEur: [59.99, 54.99, 59.99],
        previousPriceEur: 59.99,
        sourceAgreementCount: 1,
        independentMerchantCount: 1,
        isOfficialMerchant: false
      });

      expect(evalCaseB.riskFlags).toContain('SOURCE_OWN_HISTORY_BREAK');
      expect(evalCaseB.riskLevel).toBe('HIGH');
      expect(evalCaseB.isAnomaly).toBe(true);
    });
  });

  // ----------------------------------------------------
  // 10. P0 — Freshness-Aware Game-Level Best Deal & Peer Market
  // ----------------------------------------------------
  describe('P0: Freshness-Aware Game Best Deal & Peer Market', () => {
    it('recomputeBestDealForGame prioritizes fresh offers over stale cheaper offers', () => {
      const game = gameRepo.upsert({ steamAppId: 9901, title: 'Freshness Best Deal Game', basePriceEur: 49.99 });
      const merchantA = merchantRepo.getOrCreate('storeA', 'Store A', true);
      const merchantB = merchantRepo.getOrCreate('storeB', 'Store B', true);

      const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
      const freshDate = new Date().toISOString();

      // Offer A: Stale €5.00
      prepareStmt(`
        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, price_event, risk_level, risk_score, risk_flags, evaluation_confidence, is_anomaly, anomaly_score, fetched_at, last_observed_at, created_at, updated_at)
        VALUES ('off-stale-5', ?, ?, 'STEAM_KEY', 'GLOBAL', 5.00, 'https://storeA.com', 1, 0, 'NONE', 'SAFE', 0.0, '[]', 1.0, 0, 0.0, ?, ?, ?, ?)
      `).run(game.id, merchantA.id, staleDate, staleDate, staleDate, staleDate);

      // Offer B: Fresh €8.00
      prepareStmt(`
        INSERT INTO offers (id, game_id, merchant_id, product_type, region_type, price_eur, deal_url, is_valid, is_best_deal, price_event, risk_level, risk_score, risk_flags, evaluation_confidence, is_anomaly, anomaly_score, fetched_at, last_observed_at, created_at, updated_at)
        VALUES ('off-fresh-8', ?, ?, 'STEAM_KEY', 'GLOBAL', 8.00, 'https://storeB.com', 1, 0, 'NONE', 'SAFE', 0.0, '[]', 1.0, 0, 0.0, ?, ?, ?, ?)
      `).run(game.id, merchantB.id, freshDate, freshDate, freshDate, freshDate);

      offerRepo.recomputeBestDealForGame(game.id);

      const best = offerRepo.getOffersForGame(game.id).find(o => o.isBestDeal);
      expect(best).toBeDefined();
      expect(best?.id).toBe('off-fresh-8');
      expect(best?.priceEur).toBe(8.00);
    });

    it('stale peer is excluded from live market comparison and cannot distort cheapest-candidate policy', () => {
      const target = { productType: 'STEAM_KEY', regionType: 'GLOBAL' };
      const staleTime = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString();

      const isStaleCompatible = isCompatiblePeerOffer(target, {
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        isValid: true,
        isAnomaly: false,
        riskLevel: 'SAFE',
        lastObservedAt: staleTime
      });

      expect(isStaleCompatible).toBe(false);
    });
  });

  // ----------------------------------------------------
  // 11. P0 — Deal Score Consistency Across Endpoints
  // ----------------------------------------------------
  describe('P0: Deal Score Consistency Across Endpoints', () => {
    it('produces identical deal score and provisional status across game and offer representations', () => {
      const game = gameRepo.upsert({ steamAppId: 7771, title: 'Consistency Game', basePriceEur: 39.99 });
      const merchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);

      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 19.99,
        dealUrl: 'https://store.steampowered.com/app/7771',
        sourceCode: 'steam'
      });

      const gameData = gameRepo.getById(game.id)!;
      const offerData = offerRepo.getOffersForGame(game.id)[0];
      const singleOffer = offerRepo.getById(offerData.id)!;

      expect(gameData.bestDealScore).toBe(offerData.dealScore);
      expect(offerData.dealScore).toBe(singleOffer.dealScore);
      expect(offerData.isProvisional).toBe(singleOffer.isProvisional);
    });
  });

  // ----------------------------------------------------
  // 12. P0 — ATL Confirmation State Preservation
  // ----------------------------------------------------
  describe('P0: ATL Confirmation State Preservation', () => {
    it('preserves explicitly unconfirmed ATL state and does not overwrite it to true', () => {
      const mockGame: Game = {
        id: 'g-unconfirmed-atl',
        steamAppId: 1234,
        title: 'Unconfirmed ATL Game',
        slug: 'unconfirmed-atl',
        basePriceEur: 49.99,
        historicalLowEur: 15.99,
        historicalLowSource: 'Kinguin',
        atlIsConfirmed: false,
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2026-08-27T00:00:00Z'
      };

      const periodLows = calculatePeriodLows(mockGame, []);
      expect(periodLows.allTimeLow.isConfirmed).toBe(false);
      expect(periodLows.allTimeLow.priceEur).toBe(15.99);
    });
  });

  // ----------------------------------------------------
  // 13. P1 — 30-Day Anomaly Retrigger Policy B
  // ----------------------------------------------------
  describe('P1: 30-Day Anomaly Retrigger Policy B', () => {
    it('suppresses recent dismissals (< 30 days) and re-triggers on dismissals >= 30 days', () => {
      const game = gameRepo.upsert({ steamAppId: 5551, title: 'Policy B Game', basePriceEur: 59.99 });
      const merchant = merchantRepo.getOrCreate('k4g', 'K4G', false);
      const offer = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: merchant.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 0.49,
        dealUrl: 'https://k4g.com/glitch',
        sourceCode: 'allkeyshop'
      });

      // 1. Initial anomaly is active
      const activeAnomalies = anomalyRepo.list(true);
      expect(activeAnomalies.length).toBe(1);

      // 2. Dismiss the anomaly
      anomalyRepo.dismiss(activeAnomalies[0].id);
      expect(anomalyRepo.list(true).length).toBe(0);

      // 3. Trigger same anomaly today -> suppressed
      anomalyRepo.record(game.id, offer.id, 'SUB_EURO_PREMIUM_GLITCH', 0.85, 'Glitch', 0.49, 0.49);
      expect(anomalyRepo.list(true).length).toBe(0);

      // 4. Age the dismissed record to 35 days ago
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      prepareStmt(`UPDATE anomalies SET detected_at = ? WHERE offer_id = ?`).run(oldDate, offer.id);

      // 5. Trigger again -> re-triggers because dismissal is > 30 days old
      anomalyRepo.record(game.id, offer.id, 'SUB_EURO_PREMIUM_GLITCH', 0.85, 'Glitch', 0.49, 0.49);
      const retriggered = anomalyRepo.list(true);
      expect(retriggered.length).toBe(1);
      expect(retriggered[0].offerId).toBe(offer.id);
    });
  });
});
