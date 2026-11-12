#!/usr/bin/env node
/**
 * PriceSteamTool — Historical Price Event Reclassification & Reversible Repair Utility
 *
 * Replays historical price movements chronologically using domain/pricingError/priceEvents logic.
 * Corrects false Fresh Drops caused by micro-fluctuations (<= €0.015, < 5% under €0.05)
 * and unverified record claims.
 *
 * Usage:
 *   node scripts/repair-historical-price-events.cjs [dbPath] [--dry-run | --apply | --rollback | --verify]
 *
 * Default is --dry-run. Never alters data unless --apply is explicitly specified.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const EPSILON_EUR = 0.005;

function detectPriceEvent(input, isPricingError = false) {
  const currentPriceEur = input.currentPriceEur ?? input.priceEur ?? 0;
  const originalPriceEur = input.originalPriceEur ?? input.claimedOriginalPriceEur;
  const basePriceEur = input.basePriceEur ?? input.steamBasePriceEur;
  const historicalLowEur = input.historicalLowEur ?? input.confirmedAtlEur;
  const previousPriceEur = input.previousPriceEur;
  const isOfficialMerchant = input.isOfficialMerchant ?? false;
  const sourceAgreementCount = input.sourceAgreementCount ?? 1;
  const independentMerchantCount = input.independentMerchantCount ?? 1;

  if (currentPriceEur <= 0) return 'NONE';
  if (isPricingError) return 'PRICING_ERROR';

  if (previousPriceEur !== undefined && previousPriceEur > 0 && currentPriceEur > previousPriceEur + EPSILON_EUR) {
    return 'PRICE_INCREASE';
  }

  // Micro-fluctuation noise filter
  if (previousPriceEur !== undefined && previousPriceEur > 0) {
    const priceDeltaEur = previousPriceEur - currentPriceEur;
    if (priceDeltaEur <= EPSILON_EUR) return 'NONE';
    if (priceDeltaEur <= 0.015) return 'NONE';
    const relativeDropPercent = (priceDeltaEur / previousPriceEur) * 100;
    if (priceDeltaEur < 0.05 && relativeDropPercent < 5.0) {
      return 'NONE';
    }
  }

  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || independentMerchantCount >= 2 || isOfficialMerchant) && !isPricingError;

  if (isConfirmedAtl) return 'RECORD_DROP';
  if (isNewAtl) return 'UNCONFIRMED_RECORD_DROP';

  const msrp = basePriceEur || originalPriceEur || 0;
  const discountPercent = msrp > 0 ? Math.max(0, ((msrp - currentPriceEur) / msrp) * 100) : 0;
  const absoluteDropEur = msrp > 0 ? Math.max(0, msrp - currentPriceEur) : 0;

  const isAtAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.02 && !isPricingError;
  const isNearAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.10 && !isPricingError;

  const isExtremeDrop = msrp > 0 && (
    (discountPercent >= 75 && (absoluteDropEur >= 15 || msrp >= 20)) ||
    (discountPercent >= 80 && absoluteDropEur >= 10) ||
    (discountPercent >= 70 && absoluteDropEur >= 20) ||
    (isAtAtl && discountPercent >= 65 && absoluteDropEur >= 15)
  );

  if (isExtremeDrop) return 'EXTREME_DROP';

  const isMajorDrop = msrp > 0 && (
    (discountPercent >= 50 && (absoluteDropEur >= 15 || msrp >= 20)) ||
    (isNearAtl && discountPercent >= 45)
  );

  if (isMajorDrop) return 'MAJOR_DROP';
  if (isAtAtl && discountPercent >= 20) return 'MAJOR_DROP';
  if (isNearAtl && discountPercent >= 20) return 'MAJOR_DROP';
  if (discountPercent >= 30 || absoluteDropEur >= 10) return 'SIGNIFICANT_DROP';
  if (discountPercent >= 10) return 'MODERATE_DROP';

  return 'NONE';
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = null;
  let mode = 'dry-run';

  for (const arg of args) {
    if (arg === '--apply') mode = 'apply';
    else if (arg === '--rollback') mode = 'rollback';
    else if (arg === '--verify') mode = 'verify';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (!arg.startsWith('--')) dbPath = arg;
  }

  if (!dbPath) {
    dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'pricetool.db');
  }

  return { dbPath, mode };
}

function run() {
  const { dbPath, mode } = parseArgs();

  console.log(`====================================================================`);
  console.log(`  PriceSteamTool — Historical Price Event Repair Utility`);
  console.log(`====================================================================`);
  console.log(`Target Database: ${dbPath}`);
  console.log(`Execution Mode:  ${mode.toUpperCase()}`);
  console.log(`Started At:      ${new Date().toISOString()}\n`);

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database file does not exist at: ${dbPath}`);
    process.exit(1);
  }

  const readonly = (mode === 'dry-run' || mode === 'verify');
  const db = new Database(dbPath, { readonly });
  db.pragma('journal_mode = WAL');

  if (mode === 'rollback') {
    executeRollback(db);
    return;
  }

  if (mode === 'verify') {
    executeVerify(db);
    return;
  }

  executeReplay(db, mode === 'apply', dbPath);
}

function executeRollback(db) {
  console.log(`[Rollback] Checking for existing backup table...`);
  const backupTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='price_history_event_backup'`).get();
  if (!backupTable) {
    console.error(`[Rollback] Error: No backup table 'price_history_event_backup' found. Cannot rollback.`);
    process.exit(1);
  }

  const backupCount = db.prepare(`SELECT COUNT(*) as c FROM price_history_event_backup`).get().c;
  console.log(`[Rollback] Found ${backupCount} backed-up records.`);

  const tx = db.transaction(() => {
    // Restore price_history
    const updateStmt = db.prepare(`
      UPDATE price_history 
      SET price_event = (SELECT original_price_event FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id)
      WHERE id IN (SELECT id FROM price_history_event_backup)
    `);
    const histResult = updateStmt.run();
    console.log(`[Rollback] Restored ${histResult.changes} records in price_history.`);

    db.prepare(`DROP TABLE price_history_event_backup`).run();
    console.log(`[Rollback] Backup table cleanly dropped.`);
  });

  tx();
  console.log(`[Rollback] Rollback completed successfully and atomically.`);
}

function executeVerify(db) {
  console.log(`[Verify] Inspecting current classification status and backup tables...`);
  const backupTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='price_history_event_backup'`).get();
  if (backupTable) {
    const backupCount = db.prepare(`SELECT COUNT(*) as c FROM price_history_event_backup`).get().c;
    console.log(`[Verify] Active backup table 'price_history_event_backup' contains ${backupCount} entries.`);
  } else {
    console.log(`[Verify] No active backup table found (Database is in original state or rollback was performed).`);
  }

  const dropEventCounts = db.prepare(`
    SELECT price_event, COUNT(*) as count 
    FROM price_history 
    GROUP BY price_event 
    ORDER BY count DESC
  `).all();

  console.log(`\n[Verify] Current stored price_history event distribution:`);
  for (const row of dropEventCounts) {
    console.log(`  ${(row.price_event || 'NULL').padEnd(25)}: ${row.count}`);
  }
}

function executeReplay(db, applyChanges, dbPath) {
  const timeRange = db.prepare(`SELECT MIN(recorded_at) as earliest, MAX(recorded_at) as latest, COUNT(*) as total FROM price_history`).get();
  console.log(`Dataset size: ${timeRange.total} records (from ${timeRange.earliest} to ${timeRange.latest})`);

  // Load games map
  const gamesMap = new Map();
  for (const g of db.prepare(`SELECT id, title, base_price_eur, historical_low_eur FROM games`).all()) {
    gamesMap.set(g.id, g);
  }

  // Load merchants map
  const merchantsMap = new Map();
  for (const m of db.prepare(`SELECT id, code, name, is_official FROM merchants`).all()) {
    merchantsMap.set(m.id, Boolean(m.is_official));
  }

  console.log(`Loaded ${gamesMap.size} games and ${merchantsMap.size} merchants.`);
  console.log(`Streaming price history in chronological order per stream...`);

  const allHistory = db.prepare(`
    SELECT id, game_id, merchant_id, source_code, price_eur, price_event, is_pricing_error, recorded_at
    FROM price_history
    ORDER BY game_id, merchant_id, source_code, recorded_at ASC, id ASC
  `).all();

  const streamPrevious = new Map();
  const transitionMatrix = {};
  const affectedGames = new Set();
  const changes = [];

  const nowReference = new Date(timeRange.latest);
  const oneDayAgo = new Date(nowReference.getTime() - 1 * 24 * 3600 * 1000).toISOString();
  const threeDaysAgo = new Date(nowReference.getTime() - 3 * 24 * 3600 * 1000).toISOString();
  const sevenDaysAgo = new Date(nowReference.getTime() - 7 * 24 * 3600 * 1000).toISOString();

  let storedDrops1d = new Set();
  let storedDrops3d = new Set();
  let storedDrops7d = new Set();

  let correctedDrops1d = new Set();
  let correctedDrops3d = new Set();
  let correctedDrops7d = new Set();

  const gameLatestCorrectedDropAt = new Map();

  for (const row of allHistory) {
    const streamKey = `${row.game_id}_${row.merchant_id}_${row.source_code}`;
    const previousPriceEur = streamPrevious.get(streamKey);
    streamPrevious.set(streamKey, row.price_eur);

    const game = gamesMap.get(row.game_id);
    const isOfficial = merchantsMap.get(row.merchant_id) || false;

    const correctedEvent = detectPriceEvent({
      currentPriceEur: row.price_eur,
      previousPriceEur,
      basePriceEur: game?.base_price_eur,
      historicalLowEur: game?.historical_low_eur,
      isOfficialMerchant: isOfficial
    }, Boolean(row.is_pricing_error));

    const storedEvent = row.price_event || 'NONE';

    const isStoredDrop = !['NONE', 'PRICE_INCREASE', 'PRICING_ERROR'].includes(storedEvent);
    const isCorrectedDrop = !['NONE', 'PRICE_INCREASE', 'PRICING_ERROR'].includes(correctedEvent);

    if (isStoredDrop) {
      if (row.recorded_at >= oneDayAgo) storedDrops1d.add(row.game_id);
      if (row.recorded_at >= threeDaysAgo) storedDrops3d.add(row.game_id);
      if (row.recorded_at >= sevenDaysAgo) storedDrops7d.add(row.game_id);
    }

    if (isCorrectedDrop) {
      if (row.recorded_at >= oneDayAgo) correctedDrops1d.add(row.game_id);
      if (row.recorded_at >= threeDaysAgo) correctedDrops3d.add(row.game_id);
      if (row.recorded_at >= sevenDaysAgo) correctedDrops7d.add(row.game_id);

      const existingLatest = gameLatestCorrectedDropAt.get(row.game_id);
      if (!existingLatest || row.recorded_at > existingLatest) {
        gameLatestCorrectedDropAt.set(row.game_id, row.recorded_at);
      }
    }

    if (storedEvent !== correctedEvent) {
      affectedGames.add(row.game_id);
      const key = `${storedEvent} -> ${correctedEvent}`;
      transitionMatrix[key] = (transitionMatrix[key] || 0) + 1;
      changes.push({
        id: row.id,
        gameId: row.game_id,
        storedEvent,
        correctedEvent
      });
    }
  }

  console.log(`\n--- RECLASSIFICATION AUDIT METRICS ---`);
  console.log(`Total records evaluated:              ${allHistory.length}`);
  console.log(`Total records to reclassify:          ${changes.length} (${((changes.length / allHistory.length) * 100).toFixed(2)}%)`);
  console.log(`Unique games affected:                ${affectedGames.size} (${((affectedGames.size / gamesMap.size) * 100).toFixed(1)}% of all games)`);

  console.log(`\n--- TOP TRANSITIONS (Stored -> Corrected) ---`);
  const sortedTransitions = Object.entries(transitionMatrix).sort((a, b) => b[1] - a[1]);
  for (const [trans, count] of sortedTransitions.slice(0, 12)) {
    console.log(`  ${trans.padEnd(35)} : ${count}`);
  }

  console.log(`\n--- FRESH DROPS IMPACT (Stored Feed vs Corrected Feed) ---`);
  console.log(`  • 1-Day Window (< 24h): Stored=${storedDrops1d.size} games -> Corrected=${correctedDrops1d.size} games (-${storedDrops1d.size - correctedDrops1d.size} false alarms, -${(((storedDrops1d.size - correctedDrops1d.size) / storedDrops1d.size) * 100).toFixed(1)}%)`);
  console.log(`  • 3-Day Window (< 72h): Stored=${storedDrops3d.size} games -> Corrected=${correctedDrops3d.size} games (-${storedDrops3d.size - correctedDrops3d.size} false alarms, -${(((storedDrops3d.size - correctedDrops3d.size) / storedDrops3d.size) * 100).toFixed(1)}%)`);
  console.log(`  • 7-Day Window (< 7d):  Stored=${storedDrops7d.size} games -> Corrected=${correctedDrops7d.size} games (-${storedDrops7d.size - correctedDrops7d.size} false alarms, -${(((storedDrops7d.size - correctedDrops7d.size) / storedDrops7d.size) * 100).toFixed(1)}%)`);

  if (!applyChanges) {
    console.log(`\n[DRY RUN COMPLETE] Zero database modifications performed.`);
    console.log(`To execute this repair atomically and create reversible backup tables, run:`);
    console.log(`  node scripts/repair-historical-price-events.cjs "${dbPath}" --apply\n`);
    return;
  }

  console.log(`\n[APPLY] Beginning atomic reversible repair transaction...`);
  const nowIso = new Date().toISOString();

  const applyTx = db.transaction(() => {
    // 1. Create price_history_event_backup
    db.prepare(`
      CREATE TABLE IF NOT EXISTS price_history_event_backup (
        id TEXT PRIMARY KEY,
        original_price_event TEXT NOT NULL,
        reclassified_price_event TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `).run();

    // 2. Insert backups and update price_history in batches
    const insertBackupStmt = db.prepare(`
      INSERT OR REPLACE INTO price_history_event_backup (id, original_price_event, reclassified_price_event, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const updateEventStmt = db.prepare(`
      UPDATE price_history SET price_event = ? WHERE id = ?
    `);

    for (const change of changes) {
      insertBackupStmt.run(change.id, change.storedEvent, change.correctedEvent, nowIso);
      updateEventStmt.run(change.correctedEvent, change.id);
    }
    console.log(`[APPLY] Updated ${changes.length} records in price_history and stored in backup table.`);

  });

  applyTx();
  console.log(`\n[APPLY SUCCESS] Transaction committed. All changes are backed up and fully reversible.`);
  console.log(`Notice: 'latest_price_drop_at' is a dynamic subquery on 'price_history' in Pricetool queries,`);
  console.log(`so all game drop timestamps, badges, and filters update automatically with zero schema changes.`);
  console.log(`To rollback at any time, run:`);
  console.log(`  node scripts/repair-historical-price-events.cjs "${dbPath}" --rollback\n`);
}

run();
