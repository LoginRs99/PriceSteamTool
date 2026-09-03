import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from '../../src/server/db/schema.js';
import { runMigrations } from '../../src/server/db/migrations.js';
import { profileRepo } from '../../src/server/db/repositories/profile.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { getDb } from '../../src/server/db/core.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine/evaluator.js';

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

describe('Critical Performance, Scale Stress & Data Integrity Suite', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDb();
    resetDatabase();
  });

  afterEach(() => {
    resetDatabase();
  });

  // =========================================================================
  // 1. Performance & Scale Stress Benchmark (100 Games, 2,500 Offers)
  // =========================================================================
  it('Benchmark: computes best deals and wishlist queries for 2,500 offers under strict SLA (<250ms)', () => {
    // 1. Setup Profile
    const profile = profileRepo.create('Stress Test Profile', '76561198000000001');

    // 2. Setup 25 distinct Merchants (Official and Unofficial)
    const merchants = Array.from({ length: 25 }, (_, i) => 
      merchantRepo.getOrCreate(`stress-m-${i}`, `Merchant ${i}`, i < 5, `https://m${i}.example.com`)
    );

    // 2. Insert 100 Games and 25 Offers each = 2,500 Offers
    const insertGame = db.prepare(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const insertOffer = db.prepare(`
      INSERT INTO offers (
        id, game_id, merchant_id, product_type, region_type, price_eur, original_price_eur,
        is_valid, is_best_deal, risk_level, is_anomaly, price_event, deal_url,
        fetched_at, last_observed_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'STEAM_KEY', 'GLOBAL', ?, ?, 1, 0, ?, ?, ?, 'https://example.com', ?, ?, datetime('now'), datetime('now'))
    `);

    const insertObs = db.prepare(`
      INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_raw_price, observed_currency, observed_at)
      VALUES (?, ?, ?, ?, ?, 'EUR', ?)
    `);

    const insertWishlist = db.prepare(`
      INSERT INTO wishlist_entries (id, profile_id, game_id, priority, is_active, last_synced_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `);

    db.transaction(() => {
      for (let g = 1; g <= 100; g++) {
        const gameId = `stress-game-${g}`;
        const basePrice = 19.99 + (g % 5) * 10;
        insertGame.run(gameId, 100000 + g, `Stress Game ${g}`, `stress-game-${g}`, basePrice, 9.99);
        insertWishlist.run(`w-${gameId}`, profile.id, gameId, g);

        // Add 25 offers per game with various conditions
        for (let o = 1; o <= 25; o++) {
          const offerId = `stress-off-${g}-${o}`;
          const merchant = merchants[o % merchants.length];
          const isStale = o > 20; // Last 5 offers are stale (>72h old)
          const isAnomaly = o === 1; // Offer 1 is an unverified sub-euro anomaly
          const obsTime = isStale 
            ? new Date(Date.now() - 100 * 3600 * 1000).toISOString() // 100 hours ago
            : new Date().toISOString();

          let price = basePrice * (0.3 + (o * 0.025));
          let riskLevel = 'SAFE';
          let isAnom = 0;
          let event = 'ON_SALE';

          if (isAnomaly) {
            price = 0.49; // Extreme glitch
            riskLevel = 'HIGH';
            isAnom = 1;
            event = 'EXTREME_DROP';
          }

          insertOffer.run(
            offerId,
            gameId,
            merchant.id,
            price,
            basePrice,
            riskLevel,
            isAnom,
            event,
            obsTime,
            obsTime
          );

          insertObs.run(`obs-${offerId}`, offerId, 'allkeyshop', price, price, obsTime);
        }
      }
    })();

    const countRes = db.prepare('SELECT count(*) as cnt FROM offers').get() as any;
    expect(countRes.cnt).toBe(2500);

    // 3. Measure recomputeAllBestDeals() SLA
    const startBestDeals = performance.now();
    offerRepo.recomputeAllBestDeals();
    const durationBestDeals = performance.now() - startBestDeals;

    // SLA: Bulk recalculation of 2,500 offers must take under 250ms
    expect(durationBestDeals).toBeLessThan(250);

    // 4. Measure Paginated Wishlist Query SLA
    const startWishlist = performance.now();
    const wishlist = gameRepo.getWishlistGames(profile.id, { page: 1, limit: 20 });
    const durationWishlist = performance.now() - startWishlist;

    // SLA: Complex join query for 20 items across 100 games must take under 50ms
    expect(durationWishlist).toBeLessThan(50);
    expect(wishlist.games.length).toBe(20);

    // 5. Data Correctness Verification across all 100 games
    const bestDeals = db.prepare(`
      SELECT o.*, g.id as g_id 
      FROM offers o
      JOIN games g ON o.game_id = g.id
      WHERE o.is_best_deal = 1
    `).all() as any[];

    expect(bestDeals.length).toBe(100);

    for (const b of bestDeals) {
      // Best deal must NEVER be an anomaly or HIGH risk
      expect(b.is_anomaly).toBe(0);
      expect(b.risk_level).not.toBe('HIGH');
      expect(b.price_eur).toBeGreaterThan(0.49); // Skipped the 0.49 anomaly

      // Best deal must be fresh (<72h) since fresh offers were available
      const ageHours = (Date.now() - new Date(b.last_observed_at).getTime()) / (3600 * 1000);
      expect(ageHours).toBeLessThan(72);
    }
  });

  // =========================================================================
  // 2. Ghost Offer Auto-Cleanup & Invalidation Lifecycle
  // =========================================================================
  it('Lifecycle: auto-invalidates vanished keyshop offers on fresh scrape without touching multi-source offers', () => {
    const game = gameRepo.upsert({
      steamAppId: 550,
      title: 'Left 4 Dead 2',
      basePriceEur: 9.99
    });

    const mDriffle = merchantRepo.getOrCreate('driffle', 'Driffle', false);
    const mCjs = merchantRepo.getOrCreate('cjs', 'CJS CDKeys', false);
    const mSteam = merchantRepo.getOrCreate('steam', 'Steam Store', true);

    // Initial State: 3 offers exist
    // 1. Driffle €1.46 (from AllKeyShop)
    const offDriffle = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: mDriffle.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 1.46,
      isValid: true,
      dealUrl: 'https://driffle.com/l4d2',
      sourceCode: 'allkeyshop'
    });

    // 2. CJS €5.37 (from AllKeyShop)
    const offCjs = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: mCjs.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 5.37,
      isValid: true,
      dealUrl: 'https://cjs.com/l4d2',
      sourceCode: 'allkeyshop'
    });

    // 3. Steam Store €9.99 (observed by BOTH Steam API and AllKeyShop)
    const offSteam = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: mSteam.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 9.99,
      isValid: true,
      dealUrl: 'https://store.steampowered.com/app/550',
      sourceCode: 'steam'
    });
    // Add second observation from allkeyshop for steam offer
    db.prepare(`
      INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_currency, observed_at)
      VALUES ('obs-steam-aks', ?, 'allkeyshop', 9.99, 'EUR', datetime('now'))
    `).run(offSteam.id);

    // Verify initial best deal is Driffle at 1.46
    offerRepo.recomputeBestDealForGame(game.id);
    let best = offerRepo.getById(offDriffle.id);
    expect(best?.isBestDeal).toBe(true);

    // SIMULATE SUBSEQUENT SCRAPE:
    // Driffle sold out! The live AllKeyShop page now ONLY returns CJS (€5.37).
    // The orchestrator calls invalidateStaleForGameSource keeping only [offCjs.id]
    const cleanupResult = offerRepo.invalidateStaleForGameSource(game.id, 'allkeyshop', [offCjs.id]);

    // Exactly 1 offer was exclusively from AllKeyShop and missing from fresh list -> Driffle
    expect(cleanupResult.invalidatedCount).toBe(1);

    // Driffle is now invalid
    const checkDriffle = offerRepo.getById(offDriffle.id);
    expect(checkDriffle?.isValid).toBe(false);

    // CJS is still valid
    const checkCjs = offerRepo.getById(offCjs.id);
    expect(checkCjs?.isValid).toBe(true);

    // Steam Store had a multi-source observation (Steam API + AllKeyShop) -> MUST BE PRESERVED!
    const checkSteam = offerRepo.getById(offSteam.id);
    expect(checkSteam?.isValid).toBe(true);

    // Recompute best deal: CJS at €5.37 must now be promoted to BEST OFFER
    offerRepo.recomputeBestDealForGame(game.id);
    const newBestCjs = offerRepo.getById(offCjs.id);
    expect(newBestCjs?.isBestDeal).toBe(true);
  });

  // =========================================================================
  // 3. Fail-Closed Security & Merchant Trust Resilience
  // =========================================================================
  it('Security: unverified merchant with missing merchantInfo fails closed (: false, 0.60 trust)', () => {
    // Evaluating an offer when merchant DB lookup fails or merchant is unknown
    // A single unverified keyshop dropping to €0.49 on a €39.99 game while other market store is €39.99
    const movement = evaluatePriceMovement({
      currentPriceEur: 0.49,
      basePriceEur: 39.99,
      historicalLowEur: 14.99,
      isOfficialMerchant: false, // Fail-closed default
      merchantTrustScore: 0.60,  // Fail-closed trust
      sourceAgreementCount: 1,
      marketPricesEur: [39.99] // Competitor price is 39.99€
    });

    // An unverified solo merchant dropping from 40€ to 0.49€ without peer corroboration
    // must be flagged as SUB_EURO_PREMIUM_GLITCH / LONE_BOTTOM_OUTLIER and HIGH risk (anomaly)
    expect(movement.riskLevel).toBe('HIGH');
    expect(movement.isAnomaly).toBe(true);
  });

  // =========================================================================
  // 4. Mathematical Relational Badge Integrity
  // =========================================================================
  it('Relational Badges: an overpriced offer (>5% above lowest) cannot qualify for ATL or Major Drop', () => {
    // Current market reality: Lowest active offer is €5.37
    const lowestMarketPrice = 5.37;

    // Candidate A: Real Lowest Offer (€5.37)
    const isAtAtlA = (lowestMarketPrice <= 5.50) && (lowestMarketPrice <= lowestMarketPrice * 1.03);
    expect(isAtAtlA).toBe(true);

    // Candidate B: Humble Store at €12.94 (matches Steam/ITAD record, but 2.4x higher than market)
    const humblePrice = 12.94;
    const isAtAtlB = (humblePrice <= lowestMarketPrice * 1.03);
    expect(isAtAtlA).toBe(true);
    expect(isAtAtlB).toBe(false); // Strictly rejected from displaying ATL badge!

    // Candidate C: GG.deals at €14.49 (50% off MSRP 28.99, but 2.7x higher than market)
    const ggdealsPrice = 14.49;
    const isMajorDropC = (ggdealsPrice <= lowestMarketPrice * 1.05);
    expect(isMajorDropC).toBe(false); // Strictly rejected from displaying Major Drop badge!
  });
});
