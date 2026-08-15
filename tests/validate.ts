import { getDb, closeDb, profileRepo, gameRepo, merchantRepo, offerRepo } from '../src/server/db/index.js';
import { normalizeProductType, normalizeRegion } from '../src/server/domain/normalizer.js';
import { evaluateOfferAnomaly } from '../src/server/domain/anomaly.js';
import { CircuitBreakerRegistry, circuitBreakers } from '../src/server/sync/circuitBreaker.js';
import { PacedSourceQueue } from '../src/server/sync/rateLimiter.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passed++;
  }
}

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
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

async function runAllValidations() {
  console.log('\n========================================');
  console.log('⚡ STARTING REAL-WORLD VALIDATION SUITE');
  console.log('========================================\n');

  // ----------------------------------------------------
  // Section 1: Region Normalization
  // ----------------------------------------------------
  console.log('--- 1. Region Filtering Validation ---');
  assert(normalizeRegion('HU').isValid === true, 'Hungary region accepted');
  assert(normalizeRegion('EU').isValid === true, 'Europe / EU region accepted');
  assert(normalizeRegion('Global').isValid === true, 'Global region accepted');
  assert(normalizeRegion('Worldwide').isValid === true, 'Worldwide region accepted');
  assert(normalizeRegion('ROW').isValid === true, 'ROW region accepted');
  
  assert(normalizeRegion('US').isValid === false, 'US region rejected');
  assert(normalizeRegion('Egypt', 'EG').isValid === false, 'Egypt region rejected');
  assert(normalizeRegion('Turkey', 'TR').isValid === false, 'Turkey region rejected');
  assert(normalizeRegion('Russia', 'RU').isValid === false, 'Russia region rejected');
  assert(normalizeRegion('China', 'CN').isValid === false, 'China region rejected');
  assert(normalizeRegion('Argentina', 'AR').isValid === false, 'Argentina region rejected');
  assert(normalizeRegion('Brazil', 'BR').isValid === false, 'Brazil region rejected');
  assert(normalizeRegion('LATAM only').isValid === false, 'LATAM region rejected');

  // ----------------------------------------------------
  // Section 2: Product Type Filtering
  // ----------------------------------------------------
  console.log('\n--- 2. Product Type Filtering Validation ---');
  assert(normalizeProductType('Steam Key').isValid === true, 'Steam Key accepted');
  assert(normalizeProductType('Steam Gift ROW').isValid === true, 'Steam Gift accepted');
  assert(normalizeProductType('Direct Purchase').isValid === true, 'Direct Purchase accepted');
  
  assert(normalizeProductType('Steam Account').isValid === false, 'Steam Account rejected');
  assert(normalizeProductType('Shared Account Login').isValid === false, 'Shared Account rejected');
  assert(normalizeProductType('Offline Activation').isValid === false, 'Offline Activation rejected');
  assert(normalizeProductType('Family Share Account').isValid === false, 'Family Share rejected');
  assert(normalizeProductType('Account Transfer').isValid === false, 'Account Transfer rejected');

  // ----------------------------------------------------
  // Section 3: Anomaly vs Historical Low
  // ----------------------------------------------------
  console.log('\n--- 3. Anomaly & Historical Low Validation ---');
  const normalSale = evaluateOfferAnomaly({
    priceEur: 14.99,
    basePriceEur: 59.99,
    isOfficial: true,
    otherPrices: [14.99, 19.99, 29.99, 59.99]
  });
  assert(normalSale.isAnomaly === false, 'Normal publisher sale is not an anomaly');

  const newHistLow = evaluateOfferAnomaly({
    priceEur: 12.50,
    basePriceEur: 59.99,
    historicalLowEur: 14.99,
    isOfficial: true,
    otherPrices: [12.50, 15.00, 19.99]
  });
  assert(newHistLow.isAnomaly === false, 'Legitimate new historical low is not flagged as anomaly');

  const typoGlitch = evaluateOfferAnomaly({
    priceEur: 0.49,
    basePriceEur: 59.99,
    isOfficial: false,
    otherPrices: [59.99, 49.99, 45.00]
  });
  assert(typoGlitch.isAnomaly === true && typoGlitch.score >= 0.8, 'Extreme sub-euro typo on €60 title is flagged as anomaly');

  // ----------------------------------------------------
  // Section 4: Circuit Breaker State Machine & Isolation
  // ----------------------------------------------------
  console.log('\n--- 4. Circuit Breaker & Source Isolation ---');
  const cb = new CircuitBreakerRegistry();
  assert(cb.getState('itad') === 'NORMAL', 'Initial state is NORMAL');

  cb.recordRateLimit('cheapshark', 30);
  assert(cb.getState('cheapshark') === 'BACKOFF', 'Rate limit transitions to BACKOFF');
  assert(cb.canExecute('cheapshark').allowed === false, 'BACKOFF blocks requests during cooldown');
  assert(cb.canExecute('itad').allowed === true, 'ITAD remains NORMAL and unaffected');

  cb.recordFailure('ggdeals', '503 Service Unavailable');
  cb.recordFailure('ggdeals', '503 Service Unavailable');
  cb.recordFailure('ggdeals', '503 Service Unavailable');
  cb.recordFailure('ggdeals', '503 Service Unavailable');
  assert(cb.getState('ggdeals') === 'PAUSED', '4 consecutive failures transitions to PAUSED');

  // ----------------------------------------------------
  // Section 5: Deduplication & Provenance
  // ----------------------------------------------------
  console.log('\n--- 5. Offer Deduplication & Provenance ---');
  resetDatabase();
  const cp = gameRepo.upsert({ steamAppId: 1091500, title: 'Cyberpunk 2077', basePriceEur: 59.99 });
  const k4g = merchantRepo.getOrCreate('k4g', 'K4G', false);

  const offer1 = offerRepo.upsertOffer({
    gameId: cp.id,
    merchantId: k4g.id,
    productType: 'STEAM_KEY',
    regionType: 'GLOBAL',
    priceEur: 18.42,
    originalPriceEur: 59.99,
    dealUrl: 'https://k4g.com/cp2077',
    sourceCode: 'itad'
  });

  const offer2 = offerRepo.upsertOffer({
    gameId: cp.id,
    merchantId: k4g.id,
    productType: 'STEAM_KEY',
    regionType: 'GLOBAL',
    priceEur: 18.20,
    originalPriceEur: 59.99,
    dealUrl: 'https://k4g.com/cp2077',
    sourceCode: 'ggdeals'
  });

  assert(offer2.id === offer1.id, 'Same merchant offer deduplicated into single canonical offer ID');
  assert(offer2.priceEur === 18.20, 'Canonical offer updated to freshest price');
  assert(offer2.sources.length === 2 && offer2.sources.includes('itad') && offer2.sources.includes('ggdeals'), 'Both source observations preserved in offer.sources');

  // ----------------------------------------------------
  // Section 6: Large Wishlist 2000-Game Simulation
  // ----------------------------------------------------
  console.log('\n--- 6. 2,000-Game Wishlist Simulation & Index Performance ---');
  resetDatabase();
  const largeProfile = profileRepo.create('Large Wishlist User', '76561198000002000');
  
  const wishlistItems = Array.from({ length: 2000 }, (_, i) => ({
    steamAppId: 100000 + i,
    title: `Game Title ${i + 1}`,
    priority: i + 1,
    dateAdded: new Date(Date.now() - i * 3600000).toISOString()
  }));

  const tStartSeed = performance.now();
  gameRepo.syncWishlistEntries(largeProfile.id, wishlistItems);
  const totalWishlist = gameRepo.getAllWishlistGameIds(largeProfile.id);
  assert(totalWishlist.length === 2000, '2000 games successfully inserted into SQLite');

  const steamStore = merchantRepo.getOrCreate('steam', 'Steam Store', true);
  const fanatical = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

  const db = getDb();
  const seedTx = db.transaction(() => {
    for (let i = 0; i < 2000; i++) {
      const gId = totalWishlist[i].id;
      const base = 29.99;
      offerRepo.upsertOffer({
        gameId: gId,
        merchantId: steamStore.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: base,
        dealUrl: `https://steam/${totalWishlist[i].steamAppId}`,
        sourceCode: 'steam'
      });
      if (i % 2 === 0) {
        offerRepo.upsertOffer({
          gameId: gId,
          merchantId: fanatical.id,
          productType: 'STEAM_KEY',
          regionType: 'EU',
          priceEur: 14.99,
          originalPriceEur: base,
          discountPercent: 50,
          dealUrl: `https://fanatical/game-${i}`,
          sourceCode: 'itad'
        });
      }
    }
  });
  seedTx();
  const tEndSeed = performance.now();
  console.log(`2,000 games + 3,000 offers seeded in ${(tEndSeed - tStartSeed).toFixed(2)}ms`);

  const tStartQuery = performance.now();
  const page1 = gameRepo.getWishlistGames(largeProfile.id, { page: 1, limit: 48, sort: 'priority' });
  const tEndQuery = performance.now();
  const queryDuration = tEndQuery - tStartQuery;

  assert(page1.total === 2000, 'Total count is exactly 2000');
  assert(page1.games.length === 48, 'Paginated result returns exactly 48 items');
  assert(queryDuration < 50, `Query duration (${queryDuration.toFixed(2)}ms) is sub-50ms`);

  const saleResult = gameRepo.getWishlistGames(largeProfile.id, { saleOnly: true, page: 1, limit: 48 });
  assert(saleResult.total === 1000, 'Sale filter returns exactly 1000 discounted games');

  // ----------------------------------------------------
  // Section 7: Cache-First & TTL Invalidation
  // ----------------------------------------------------
  console.log('\n--- 7. Cache-First & TTL Validation ---');
  // All 2000 games now have fresh offers (<1 min old)
  const staleGamesImmediate = gameRepo.getStaleWishlistGameIds(largeProfile.id, 6);
  assert(staleGamesImmediate.length === 0, '2nd Sync within 6h TTL: 0 stale games (100% Cache Hit)');

  // User adds 3 new games
  const updatedList = [
    ...wishlistItems,
    { steamAppId: 999001, title: 'Brand New 1', priority: 2001 },
    { steamAppId: 999002, title: 'Brand New 2', priority: 2002 },
    { steamAppId: 999003, title: 'Brand New 3', priority: 2003 },
  ];
  gameRepo.syncWishlistEntries(largeProfile.id, updatedList);

  const staleAfterAdd = gameRepo.getStaleWishlistGameIds(largeProfile.id, 6);
  assert(staleAfterAdd.length === 3, 'Only the 3 new games are marked stale for refresh');
  assert(staleAfterAdd.map(g => g.steamAppId).sort().join(',') === '999001,999002,999003', 'Exact new appIds identified');

  // ----------------------------------------------------
  // Section 8: Native SQLite WAL Persistence Across Restart
  // ----------------------------------------------------
  console.log('\n--- 8. Native SQLite WAL Persistence Across Lifecycle ---');
  closeDb();

  // Re-open DB
  const reopenedActive = profileRepo.getActive();
  assert(reopenedActive !== null && reopenedActive.name === 'Large Wishlist User', 'Active profile preserved after database close/reopen');
  const reopenedList = gameRepo.getWishlistGames(reopenedActive!.id, { page: 1, limit: 10 });
  assert(reopenedList.total === 2003, 'All 2,003 games intact after database close/reopen');

  console.log('\n========================================');
  console.log(`🎉 ALL VALIDATIONS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  closeDb();
}

runAllValidations().catch(err => {
  console.error('Fatal Validation Error:', err);
  process.exit(1);
});
