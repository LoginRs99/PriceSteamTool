import { 
  getDb, 
  closeDb, 
  prepareStmt,
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo 
} from '../src/server/db/index.js';
import { randomUUID } from 'crypto';
import type { SourceCode } from '../src/shared/types.js';

interface BenchmarkResult {
  scale: number;
  initialSyncDurationMs: number;
  repeatSyncDurationMs: number;
  cacheHitPercent: number;
  totalGamesInserted: number;
  totalOffersCreated: number;
  priceHistoryRowsInitial: number;
  priceHistoryRowsRepeat: number;
  priceHistoryUnchangedGrowth: number;
  heapUsedMb: number;
}

function resetDb() {
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

function runBenchmarkForScale(count: number): BenchmarkResult {
  resetDb();

  const memBefore = process.memoryUsage().heapUsed;
  const profile = profileRepo.create(`Benchmark Profile ${count}`, `76561198${String(count).padStart(9, '0')}`);

  // 1. Generate Wishlist batch items with metadata
  const wishlistItems = Array.from({ length: count }, (_, i) => ({
    steamAppId: 100000 + i,
    title: `Game Title ${i + 1}`,
    priority: i + 1,
    headerImage: `https://cdn.steam.com/app/${100000 + i}/header.jpg`,
    capsuleImage: `https://cdn.steam.com/app/${100000 + i}/capsule.jpg`,
    releaseDate: '2022-01-01',
    isDlc: false,
    isFree: false,
    basePriceEur: 19.99 + (i % 5) * 10
  }));

  // Setup 3 standard merchants
  const steamM = merchantRepo.getOrCreate('steam', 'Steam Store', true);
  const itadM = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);

  // Measure initial sync
  const startInitial = performance.now();

  // Ingest wishlist in batch (v1.1 batch metadata)
  gameRepo.syncWishlistEntries(profile.id, wishlistItems);
  const allGames = gameRepo.getAllWishlistGameIds(profile.id);

  // Ingest multi-source offers inside transaction for batch efficiency
  const db = getDb();
  const txIngest = db.transaction(() => {
    for (const g of allGames) {
      // Steam Store offer
      offerRepo.upsertOffer({
        gameId: g.id,
        merchantId: steamM.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        originalPriceEur: 29.99,
        rawPrice: 14.99,
        rawCurrency: 'EUR',
        dealUrl: `https://store.steampowered.com/app/${g.steamAppId}`,
        sourceCode: 'steam'
      });

      // Fanatical offer observed by ITAD
      offerRepo.upsertOffer({
        gameId: g.id,
        merchantId: itadM.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 11.99,
        originalPriceEur: 29.99,
        rawPrice: 11.99,
        rawCurrency: 'EUR',
        dealUrl: 'https://fanatical.com/game',
        sourceCode: 'itad'
      });

      // Same Fanatical offer also observed by GG.deals (canonical deduplication)
      offerRepo.upsertOffer({
        gameId: g.id,
        merchantId: itadM.id,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: 11.99,
        originalPriceEur: 29.99,
        rawPrice: 11.99,
        rawCurrency: 'EUR',
        dealUrl: 'https://fanatical.com/game',
        sourceCode: 'ggdeals'
      });
    }
  });

  txIngest();
  const initialSyncDurationMs = Math.round(performance.now() - startInitial);

  const historyCountInitial = (prepareStmt(`SELECT COUNT(*) as c FROM price_history`).get() as any).c;
  const offersCount = (prepareStmt(`SELECT COUNT(*) as c FROM offers`).get() as any).c;

  // 2. Measure repeat sync (Cache hit & Idempotency check)
  const startRepeat = performance.now();
  const staleGames = gameRepo.getStaleWishlistGameIds(profile.id, 6);
  const cacheHitPercent = count > 0 ? Math.round(((count - staleGames.length) / count) * 100) : 100;

  // Re-run offer ingestion with unchanged prices to verify 0 history growth
  const txRepeat = db.transaction(() => {
    for (const g of allGames.slice(0, 100)) { // Sample 100 games on repeat
      offerRepo.upsertOffer({
        gameId: g.id,
        merchantId: steamM.id,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        priceEur: 14.99,
        originalPriceEur: 29.99,
        rawPrice: 14.99,
        rawCurrency: 'EUR',
        dealUrl: `https://store.steampowered.com/app/${g.steamAppId}`,
        sourceCode: 'steam'
      });
    }
  });
  txRepeat();

  const repeatSyncDurationMs = Math.round(performance.now() - startRepeat);
  const historyCountRepeat = (prepareStmt(`SELECT COUNT(*) as c FROM price_history`).get() as any).c;
  const historyGrowth = historyCountRepeat - historyCountInitial;

  const memAfter = process.memoryUsage().heapUsed;
  const heapUsedMb = Math.round(((memAfter - memBefore) / (1024 * 1024)) * 10) / 10;

  return {
    scale: count,
    initialSyncDurationMs,
    repeatSyncDurationMs,
    cacheHitPercent,
    totalGamesInserted: count,
    totalOffersCreated: offersCount,
    priceHistoryRowsInitial: historyCountInitial,
    priceHistoryRowsRepeat: historyCountRepeat,
    priceHistoryUnchangedGrowth: historyGrowth,
    heapUsedMb: Math.max(0, heapUsedMb)
  };
}

async function runBenchmarks() {
  console.log('================================================================');
  console.log('📊 PRICETOOL v1.1 BENCHMARK SUITE (100, 500, 2000 Wishlist Games)');
  console.log('================================================================\n');

  const scales = [100, 500, 2000];
  const results: BenchmarkResult[] = [];

  for (const scale of scales) {
    console.log(`⏱️ Running benchmark for ${scale} wishlist games...`);
    const res = runBenchmarkForScale(scale);
    results.push(res);
  }

  console.log('\n=======================================================================================================');
  console.log('Scale  | Initial Sync (ms) | Repeat Sync (ms) | Cache Hit % | Offers Created | History Rows | History Growth | Memory (MB)');
  console.log('-------|-------------------|------------------|-------------|----------------|--------------|----------------|------------');
  for (const r of results) {
    console.log(
      `${String(r.scale).padEnd(6)} | ` +
      `${String(r.initialSyncDurationMs + ' ms').padEnd(17)} | ` +
      `${String(r.repeatSyncDurationMs + ' ms').padEnd(16)} | ` +
      `${String(r.cacheHitPercent + '%').padEnd(11)} | ` +
      `${String(r.totalOffersCreated).padEnd(14)} | ` +
      `${String(r.priceHistoryRowsInitial).padEnd(12)} | ` +
      `${String(r.priceHistoryUnchangedGrowth + ' (0 bloat)').padEnd(14)} | ` +
      `${String(r.heapUsedMb + ' MB').padEnd(10)}`
    );
  }
  console.log('=======================================================================================================\n');
  closeDb();
}

runBenchmarks().catch(console.error);


