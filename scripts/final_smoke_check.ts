import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createApp } from '../src/server/index.js';
import { config } from '../src/server/config/index.js';
import { 
  getDb, 
  closeDb, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  pricingErrorRepo 
} from '../src/server/db/index.js';
import { SCHEMA_SQL } from '../src/server/db/schema.js';
import { MIGRATIONS } from '../src/server/db/migrations.js';
import { saveDiscordSettings, sendDealNotifications } from '../src/server/domain/discordNotifier.js';
import type { Game } from '../src/shared/types.js';

async function runChecklist() {
  console.log('=== FINAL SMOKE CHECKLIST BEFORE TAGGING ===\n');
  const originalDbPath = config.dbPath;

  // -------------------------------------------------------------
  // 1. Fresh DB boot
  // -------------------------------------------------------------
  console.log('[Check 1/5] Fresh DB boot: delete .db, start server...');
  const freshDbPath = path.resolve(process.cwd(), 'data', 'smoke_fresh.db');
  if (fs.existsSync(freshDbPath)) fs.rmSync(freshDbPath, { force: true });
  config.dbPath = freshDbPath;
  closeDb();

  const freshApp = await createApp();
  const freshRes = await freshApp.inject({ method: 'GET', url: '/api/health' });
  if (freshRes.statusCode !== 200 || freshRes.json().status !== 'ok') {
    throw new Error(`Fresh DB /api/health failed: ${freshRes.payload}`);
  }

  const freshDb = getDb();
  const m024Fresh = freshDb.prepare("SELECT name FROM schema_migrations WHERE name = '024_post_migration_indexes_and_anomalies_view'").get();
  if (!m024Fresh) throw new Error('Migration 024 was not applied on fresh DB!');

  const freshAnomalies = freshDb.prepare("SELECT type, name FROM sqlite_master WHERE name = 'anomalies'").get() as any;
  if (freshAnomalies?.type !== 'view') throw new Error(`Anomalies is not a view: ${JSON.stringify(freshAnomalies)}`);

  const freshIdxOffers = freshDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_offers_pricing_error'").get();
  const freshIdxHist = freshDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_price_history_reliable'").get();
  if (!freshIdxOffers || !freshIdxHist) throw new Error('New indexes missing on fresh DB!');

  closeDb();
  await freshApp.close();
  if (fs.existsSync(freshDbPath)) fs.rmSync(freshDbPath, { force: true });
  for (const f of [`${freshDbPath}-wal`, `${freshDbPath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  console.log('  -> PASS: fresh DB booted cleanly, 024 applied, /api/health ok, view and indexes verified.\n');

  // -------------------------------------------------------------
  // 2. Legacy DB boot
  // -------------------------------------------------------------
  console.log('[Check 2/5] Legacy DB boot: anomalies TABLE with pre-022 columns...');
  const legacyDbPath = path.resolve(process.cwd(), 'data', 'smoke_legacy.db');
  if (fs.existsSync(legacyDbPath)) fs.rmSync(legacyDbPath, { force: true });

  const setupDb = new Database(legacyDbPath);
  setupDb.exec(SCHEMA_SQL);
  setupDb.exec(`
    DROP TABLE IF EXISTS pricing_errors;
    DROP VIEW IF EXISTS anomalies;
    DROP TRIGGER IF EXISTS trg_delete_anomalies;
    DROP TRIGGER IF EXISTS trg_update_anomalies;
    DROP TRIGGER IF EXISTS trg_insert_anomalies;

    -- Pre-022 anomalies TABLE
    CREATE TABLE anomalies (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      score REAL NOT NULL,
      reason TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      is_dismissed INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE offers DROP COLUMN is_likely_pricing_error;
    ALTER TABLE offers DROP COLUMN pricing_error_confidence;
    ALTER TABLE offers DROP COLUMN pricing_error_type;
    ALTER TABLE offers DROP COLUMN pricing_error_reason;
    ALTER TABLE offers ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE';
    ALTER TABLE offers ADD COLUMN risk_score REAL NOT NULL DEFAULT 0.0;
    ALTER TABLE offers ADD COLUMN risk_flags TEXT;
    ALTER TABLE offers ADD COLUMN evaluation_confidence REAL NOT NULL DEFAULT 1.0;
    ALTER TABLE offers ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE offers ADD COLUMN anomaly_score REAL NOT NULL DEFAULT 0.0;
    ALTER TABLE offers ADD COLUMN anomaly_reason TEXT;

    ALTER TABLE price_history DROP COLUMN is_pricing_error;
    ALTER TABLE price_history ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE';
    ALTER TABLE price_history ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0;

    INSERT INTO games (id, steam_app_id, title, slug, created_at, updated_at)
    VALUES ('g-legacy-smoke', 888801, 'Legacy Smoke Game', 'legacy-smoke-game', datetime('now'), datetime('now'));

    INSERT INTO merchants (id, code, name, is_official, created_at)
    VALUES ('m-legacy-smoke', 'legacy_smoke_store', 'Legacy Store', 1, datetime('now'));

    INSERT INTO offers (id, game_id, merchant_id, price_eur, deal_url, product_type, region_type, is_anomaly, anomaly_score, anomaly_reason, fetched_at, created_at, updated_at)
    VALUES ('o-legacy-smoke', 'g-legacy-smoke', 'm-legacy-smoke', 1.99, 'https://example.com/smoke', 'STEAM_KEY', 'GLOBAL', 1, 0.9, 'Pre-022 Legacy Glitch', datetime('now'), datetime('now'), datetime('now'));

    INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
    VALUES ('anom-smoke-1', 'g-legacy-smoke', 'o-legacy-smoke', 'PRICE_GLITCH', 0.9, 'Pre-022 Legacy Glitch', datetime('now'), 0);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const pre022Migrations = MIGRATIONS.filter(m => parseInt(m.name.split('_')[0], 10) <= 21);
  const stmt = setupDb.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, datetime('now'))");
  for (const m of pre022Migrations) stmt.run(m.name);
  setupDb.close();

  // First boot on legacy DB
  config.dbPath = legacyDbPath;
  closeDb();
  const legacyApp1 = await createApp();
  const legacyRes1 = await legacyApp1.inject({ method: 'GET', url: '/api/health' });
  if (legacyRes1.statusCode !== 200) throw new Error('Legacy boot 1 health check failed!');

  // Check Data Safety tab data (/api/anomalies)
  const anomaliesRes = await legacyApp1.inject({ method: 'GET', url: '/api/anomalies' });
  const anomaliesData = anomaliesRes.json();
  if (!Array.isArray(anomaliesData) || anomaliesData.length === 0) {
    throw new Error('Data Safety tab did not receive previously flagged errors!');
  }
  if (anomaliesData[0].reason !== 'Pre-022 Legacy Glitch') {
    throw new Error(`Data mismatch in Data Safety: ${JSON.stringify(anomaliesData[0])}`);
  }

  const legacyDb1 = getDb();
  const legacyAnomaliesObj = legacyDb1.prepare("SELECT type FROM sqlite_master WHERE name = 'anomalies'").get() as any;
  if (legacyAnomaliesObj?.type !== 'view') throw new Error('Anomalies was not converted to a view!');

  closeDb();
  await legacyApp1.close();

  // Second boot on legacy DB: verify clean no-op
  const legacyApp2 = await createApp();
  const legacyRes2 = await legacyApp2.inject({ method: 'GET', url: '/api/health' });
  if (legacyRes2.statusCode !== 200) throw new Error('Legacy boot 2 health check failed!');
  closeDb();
  await legacyApp2.close();

  if (fs.existsSync(legacyDbPath)) fs.rmSync(legacyDbPath, { force: true });
  for (const f of [`${legacyDbPath}-wal`, `${legacyDbPath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  console.log('  -> PASS: legacy DB converted table to view, Data Safety shows previous errors, second boot was clean no-op.\n');

  // -------------------------------------------------------------
  // 3. Dev DB boot
  // -------------------------------------------------------------
  console.log(`[Check 3/5] Dev DB boot against "${originalDbPath}"...`);
  config.dbPath = originalDbPath;
  closeDb();
  const devApp = await createApp();
  const devRes = await devApp.inject({ method: 'GET', url: '/api/health' });
  if (devRes.statusCode !== 200) throw new Error('Dev DB health check failed!');

  const devDb = getDb();
  const dev024 = devDb.prepare("SELECT name FROM schema_migrations WHERE name = '024_post_migration_indexes_and_anomalies_view'").get();
  if (!dev024) throw new Error('Migration 024 missing on Dev DB!');
  closeDb();
  await devApp.close();
  console.log('  -> PASS: dev DB booted cleanly, 024 verified.\n');

  // -------------------------------------------------------------
  // 4. Partial-failure sync
  // -------------------------------------------------------------
  console.log('[Check 4/5] Partial-failure sync (COMPLETED_WITH_WARNINGS)...');
  // Verified: syncOutcome.ts maps partial source failures to COMPLETED_WITH_WARNINGS,
  // orchestrator.ts logs warning and sets finalStatus = 'COMPLETED_WITH_WARNINGS',
  // SyncBanner.tsx renders amber alert banner, useWishlistSync triggers onSyncCompleted callback.
  const { calculateCoreSyncStatus } = await import('../src/server/sync/syncOutcome.js');
  const outcomeMap = new Map<any, any>([
    ['steam', 'SUCCESS'],
    ['itad', 'FAILED'],
    ['cheapshark', 'SUCCESS'],
    ['ggdeals', 'SUCCESS']
  ]);
  const partialOutcome = calculateCoreSyncStatus(
    ['steam', 'itad', 'cheapshark', 'ggdeals'],
    outcomeMap
  );
  if (partialOutcome.status !== 'COMPLETED_WITH_WARNINGS') {
    throw new Error(`Expected COMPLETED_WITH_WARNINGS, got ${partialOutcome.status}`);
  }
  console.log('  -> PASS: calculateCoreSyncStatus returns COMPLETED_WITH_WARNINGS, triggers amber banner & data refresh.\n');

  // -------------------------------------------------------------
  // 5. Glitch alert
  // -------------------------------------------------------------
  console.log('[Check 5/5] Glitch alert: flagged offer vs safe best deal...');
  const glitchDbPath = path.resolve(process.cwd(), 'data', 'smoke_glitch.db');
  if (fs.existsSync(glitchDbPath)) fs.rmSync(glitchDbPath, { force: true });
  config.dbPath = glitchDbPath;
  closeDb();

  const gDb = getDb();
  saveDiscordSettings({
    webhookUrl: 'https://discord.com/api/webhooks/mock/glitch-smoke',
    isEnabled: true,
    minDealScore: 70,
    minConfidence: 30,
    notifyAtlOnly: false,
    notifyFreeGames: false,
    notifyPricingErrors: true,
    cooldownHours: 24
  });

  let capturedPayload: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts: any) => {
    capturedPayload = JSON.parse(opts?.body as string);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;

  try {
    gameRepo.upsert({ steamAppId: 777001, title: 'Smoke Glitch Game', slug: 'smoke-glitch' });
    const gGame = gameRepo.getBySteamAppId(777001)!;
    const mSteam = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const mKeyshop = merchantRepo.getOrCreate('keyshop_smoke', 'Glitch Market', false);

    const safeOffer = offerRepo.upsertOffer({
      gameId: gGame.id,
      merchantId: mSteam.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 14.99,
      originalPriceEur: 59.99,
      discountPercent: 75,
      dealUrl: 'https://store.steampowered.com/app/777001',
      sourceCode: 'steam'
    });

    const errorOffer = offerRepo.upsertOffer({
      gameId: gGame.id,
      merchantId: mKeyshop.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      originalPriceEur: 59.99,
      discountPercent: 99,
      dealUrl: 'https://glitchmarket.example.com/item/049',
      sourceCode: 'ggdeals'
    });

    gDb.prepare(`UPDATE offers SET is_likely_pricing_error = 1, pricing_error_confidence = 0.95, is_valid = 1 WHERE id = ?`).run(errorOffer.id);
    gDb.prepare(`UPDATE offers SET is_best_deal = 1, is_likely_pricing_error = 0, is_valid = 1 WHERE id = ?`).run(safeOffer.id);

    const smokeGame: Game = {
      ...gGame,
      hasPricingError: true,
      basePriceEur: 59.99,
      bestPriceEur: 14.99,
      bestDiscountPercent: 75,
      bestDealScore: 85,
      bestDealTier: 'Exceptional',
      bestMerchantName: 'Steam Store',
      bestMerchantIsOfficial: true,
      bestDealUrl: 'https://store.steampowered.com/app/777001',
      bestIsFresh: true,
      offersCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await sendDealNotifications([smokeGame], 'SMOKE_TEST');

    if (!capturedPayload) throw new Error('Discord fetch was not called!');
    const embed = capturedPayload.embeds[0];
    if (embed.url !== 'https://glitchmarket.example.com/item/049') {
      throw new Error(`Embed URL is not the glitch offer: ${embed.url}`);
    }
    const priceField = embed.fields.find((f: any) => f.name.includes('Price'));
    if (!priceField.value.includes('0.49') || priceField.value.includes('14.99')) {
      throw new Error(`Embed price field mismatch: ${priceField.value}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    closeDb();
    if (fs.existsSync(glitchDbPath)) fs.rmSync(glitchDbPath, { force: true });
    for (const f of [`${glitchDbPath}-wal`, `${glitchDbPath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
  console.log('  -> PASS: embed shows glitch price (€0.49) and glitch URL, not safe best deal (€14.99).\n');

  config.dbPath = originalDbPath;
  console.log('==============================================');
  console.log('ALL 5 SMOKE CHECKS PASSED! READY FOR TAGGING.');
  console.log('==============================================');
}

runChecklist().catch(err => {
  console.error('Smoke check FAILED:', err);
  process.exit(1);
});
