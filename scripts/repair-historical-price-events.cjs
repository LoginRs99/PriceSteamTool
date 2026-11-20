#!/usr/bin/env node
/**
 * PriceSteamTool — Historical Price Event Reclassification & Reversible Repair Utility
 *
 * Replays historical price movements chronologically using calibrated drop delta logic.
 * Corrects false Fresh Drops caused by:
 * 1. Initial offers misclassified as MAJOR_DROP/EXTREME_DROP instead of NEW_OFFER
 * 2. Evaluating drops against MSRP discount rather than consecutive observation difference
 * 3. Micro-fluctuations (<= €0.015, < 5% under €0.05, cheap game fluctuations)
 * 4. Dual ATL invariant violations (historical_low_eur > official_historical_low_eur)
 *
 * Usage:
 *   node scripts/repair-historical-price-events.cjs [dbPath] [--dry-run | --apply | --rollback | --verify]
 *
 * Default is --dry-run. Never alters data unless --apply is explicitly specified.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_PRICE_DROP_THRESHOLDS = {
  EPSILON_EUR: 0.005,
  NOISE_FLOOR_EUR: 0.015,
  MIN_DROP_EUR: 0.05,
  MIN_DROP_PERCENT: 5.0,
  LOW_PRICE_THRESHOLD_EUR: 5.00,
  LOW_PRICE_NOISE_EUR: 0.10,

  EXTREME_DROP_PERCENT: 50.0,
  EXTREME_DROP_MIN_EUR: 2.00,
  EXTREME_DROP_ABSOLUTE_EUR: 10.00,

  MAJOR_DROP_PERCENT: 25.0,
  MAJOR_DROP_MIN_EUR: 1.00,
  MAJOR_DROP_ABSOLUTE_EUR: 5.00,

  SIGNIFICANT_DROP_PERCENT: 15.0,
  SIGNIFICANT_DROP_MIN_EUR: 0.75,
  SIGNIFICANT_DROP_ABSOLUTE_EUR: 3.00,

  MODERATE_DROP_PERCENT: 10.0,
  MODERATE_DROP_MIN_EUR: 0.50,
};

function detectPriceEvent(input, isPricingError = false, customThresholds = {}) {
  const currentPriceEur = input.currentPriceEur ?? input.priceEur ?? 0;
  const historicalLowEur = input.historicalLowEur ?? input.confirmedAtlEur;
  const previousPriceEur = input.previousPriceEur;
  const isOfficialMerchant = input.isOfficialMerchant ?? false;
  const sourceAgreementCount = input.sourceAgreementCount ?? 1;
  const independentMerchantCount = input.independentMerchantCount ?? 1;

  if (currentPriceEur <= 0) return 'NONE';
  if (isPricingError) return 'PRICING_ERROR';

  // First-time observation -> NEW_OFFER
  if (previousPriceEur === undefined || previousPriceEur === null || previousPriceEur <= 0) {
    return 'NEW_OFFER';
  }

  const thresholds = { ...DEFAULT_PRICE_DROP_THRESHOLDS, ...customThresholds };

  // Price increase
  if (currentPriceEur > previousPriceEur + thresholds.EPSILON_EUR) {
    return 'PRICE_INCREASE';
  }

  const priceDeltaEur = previousPriceEur - currentPriceEur;

  // No decrease
  if (priceDeltaEur <= thresholds.EPSILON_EUR) {
    return 'NONE';
  }

  // Micro-fluctuation noise floor
  if (priceDeltaEur <= thresholds.NOISE_FLOOR_EUR) {
    return 'NONE';
  }

  const relativeDropPercent = (priceDeltaEur / previousPriceEur) * 100;

  // Below minimum drop & percentage
  if (priceDeltaEur < thresholds.MIN_DROP_EUR && relativeDropPercent < thresholds.MIN_DROP_PERCENT) {
    return 'NONE';
  }

  // Low-price game noise filter
  if (previousPriceEur < thresholds.LOW_PRICE_THRESHOLD_EUR && priceDeltaEur <= thresholds.LOW_PRICE_NOISE_EUR && relativeDropPercent < thresholds.MIN_DROP_PERCENT) {
    return 'NONE';
  }

  // Genuine Historical Low records (>2% drop below existing ATL)
  const isNewAtl = historicalLowEur !== undefined && historicalLowEur > 0 && currentPriceEur < historicalLowEur * 0.98;
  const isConfirmedAtl = isNewAtl && (sourceAgreementCount >= 2 || independentMerchantCount >= 2 || isOfficialMerchant) && !isPricingError;

  if (isConfirmedAtl) return 'RECORD_DROP';
  if (isNewAtl) return 'UNCONFIRMED_RECORD_DROP';

  // Drop magnitudes evaluated against actual delta from previousPriceEur
  if (
    (relativeDropPercent >= thresholds.EXTREME_DROP_PERCENT && priceDeltaEur >= thresholds.EXTREME_DROP_MIN_EUR) ||
    priceDeltaEur >= thresholds.EXTREME_DROP_ABSOLUTE_EUR
  ) {
    return 'EXTREME_DROP';
  }

  if (
    (relativeDropPercent >= thresholds.MAJOR_DROP_PERCENT && priceDeltaEur >= thresholds.MAJOR_DROP_MIN_EUR) ||
    priceDeltaEur >= thresholds.MAJOR_DROP_ABSOLUTE_EUR
  ) {
    return 'MAJOR_DROP';
  }

  if (
    (relativeDropPercent >= thresholds.SIGNIFICANT_DROP_PERCENT && priceDeltaEur >= thresholds.SIGNIFICANT_DROP_MIN_EUR) ||
    priceDeltaEur >= thresholds.SIGNIFICANT_DROP_ABSOLUTE_EUR
  ) {
    return 'SIGNIFICANT_DROP';
  }

  if (
    relativeDropPercent >= thresholds.MODERATE_DROP_PERCENT &&
    priceDeltaEur >= thresholds.MODERATE_DROP_MIN_EUR
  ) {
    return 'MODERATE_DROP';
  }

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

  const backupCols = db.prepare(`PRAGMA table_info(price_history_event_backup)`).all().map(c => c.name);
  const hasEditionBackup = backupCols.includes('original_identity_confidence');

  const tx = db.transaction(() => {
    // Restore price_history
    let updateStmt;
    if (hasEditionBackup) {
      updateStmt = db.prepare(`
        UPDATE price_history 
        SET price_event = (SELECT original_price_event FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id),
            edition_key = (SELECT original_edition_key FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id),
            edition_name = (SELECT original_edition_name FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id),
            identity_confidence = (SELECT original_identity_confidence FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id)
        WHERE id IN (SELECT id FROM price_history_event_backup)
      `);
    } else {
      updateStmt = db.prepare(`
        UPDATE price_history 
        SET price_event = (SELECT original_price_event FROM price_history_event_backup WHERE price_history_event_backup.id = price_history.id)
        WHERE id IN (SELECT id FROM price_history_event_backup)
      `);
    }
    const histResult = updateStmt.run();
    console.log(`[Rollback] Restored ${histResult.changes} records in price_history.`);

    db.prepare(`DROP TABLE price_history_event_backup`).run();
    console.log(`[Rollback] Backup table price_history_event_backup cleanly dropped.`);

    // Restore games ATL if games_atl_backup exists
    const gamesAtlBackup = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='games_atl_backup'`).get();
    if (gamesAtlBackup) {
      const restoreGamesStmt = db.prepare(`
        UPDATE games
        SET historical_low_eur = (SELECT original_historical_low_eur FROM games_atl_backup WHERE games_atl_backup.id = games.id),
            historical_low_date = (SELECT original_historical_low_date FROM games_atl_backup WHERE games_atl_backup.id = games.id),
            historical_low_source = (SELECT original_historical_low_source FROM games_atl_backup WHERE games_atl_backup.id = games.id),
            atl_is_confirmed = (SELECT original_atl_is_confirmed FROM games_atl_backup WHERE games_atl_backup.id = games.id)
        WHERE id IN (SELECT id FROM games_atl_backup)
      `);
      const gResult = restoreGamesStmt.run();
      console.log(`[Rollback] Restored ${gResult.changes} games in games table.`);
      db.prepare(`DROP TABLE games_atl_backup`).run();
      console.log(`[Rollback] Backup table games_atl_backup cleanly dropped.`);
    }
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

  // Check identity confidence distribution if column exists
  const phCols = db.prepare(`PRAGMA table_info(price_history)`).all().map(c => c.name);
  if (phCols.includes('identity_confidence')) {
    const confCounts = db.prepare(`
      SELECT identity_confidence, COUNT(*) as count
      FROM price_history
      GROUP BY identity_confidence
      ORDER BY count DESC
    `).all();
    console.log(`\n[Verify] Identity Confidence distribution:`);
    for (const row of confCounts) {
      console.log(`  ${(row.identity_confidence || 'NULL').padEnd(25)}: ${row.count}`);
    }
  }

  // Check Dual ATL invariant
  const atlViolations = db.prepare(`
    SELECT id, steam_app_id, title, official_historical_low_eur, historical_low_eur 
    FROM games 
    WHERE official_historical_low_eur IS NOT NULL 
      AND historical_low_eur IS NOT NULL 
      AND historical_low_eur > official_historical_low_eur
  `).all();

  console.log(`\n[Verify] Dual ATL Invariant Violations (historical_low_eur > official_historical_low_eur):`);
  if (atlViolations.length === 0) {
    console.log(`  PASSED: 0 violations found. Invariant holds across 100% of catalog.`);
  } else {
    console.log(`  FAILED: ${atlViolations.length} violations found:`);
    for (const v of atlViolations) {
      console.log(`    - [App ${v.steam_app_id}] ${v.title}: official=${v.official_historical_low_eur}€, overall=${v.historical_low_eur}€`);
    }
  }
}

function executeReplay(db, applyChanges, dbPath) {
  const timeRange = db.prepare(`SELECT MIN(recorded_at) as earliest, MAX(recorded_at) as latest, COUNT(*) as total FROM price_history`).get();
  console.log(`Dataset size: ${timeRange.total} records (from ${timeRange.earliest} to ${timeRange.latest})`);

  // Ensure price_history has edition and confidence columns if modifying
  const phCols = db.prepare(`PRAGMA table_info(price_history)`).all().map(c => c.name);
  const hasEditionCols = phCols.includes('edition_key') && phCols.includes('identity_confidence');

  if (!hasEditionCols && applyChanges) {
    try { db.exec("ALTER TABLE price_history ADD COLUMN edition_key TEXT DEFAULT 'standard';"); } catch {}
    try { db.exec("ALTER TABLE price_history ADD COLUMN edition_name TEXT DEFAULT 'Standard Edition';"); } catch {}
    try { db.exec("ALTER TABLE price_history ADD COLUMN identity_confidence TEXT DEFAULT 'CONFIDENT';"); } catch {}
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_price_history_edition_stream 
        ON price_history(game_id, merchant_id, source_code, edition_key, recorded_at);
        CREATE INDEX IF NOT EXISTS idx_price_history_confidence 
        ON price_history(identity_confidence);
      `);
    } catch {}
  }

  // Load games map
  const gamesMap = new Map();
  for (const g of db.prepare(`SELECT id, title, base_price_eur, historical_low_eur, official_historical_low_eur FROM games`).all()) {
    gamesMap.set(g.id, g);
  }

  // Load merchants map
  const merchantsMap = new Map();
  for (const m of db.prepare(`SELECT id, code, name, is_official FROM merchants`).all()) {
    merchantsMap.set(m.id, Boolean(m.is_official));
  }

  console.log(`Loaded ${gamesMap.size} games and ${merchantsMap.size} merchants.`);
  console.log(`Streaming price history in chronological order per stream...`);

  const selectCols = hasEditionCols 
    ? 'id, game_id, merchant_id, source_code, price_eur, price_event, is_pricing_error, edition_key, edition_name, identity_confidence, recorded_at'
    : 'id, game_id, merchant_id, source_code, price_eur, price_event, is_pricing_error, recorded_at';

  const allHistory = db.prepare(`
    SELECT ${selectCols}
    FROM price_history
    ORDER BY game_id, merchant_id, source_code, recorded_at ASC, id ASC
  `).all();

  // Step 1: Identify contaminated streams that contain concurrent observations (<= 60s apart with different prices)
  const contaminatedStreams = new Set();
  for (let i = 0; i < allHistory.length - 1; i++) {
    const cur = allHistory[i];
    const next = allHistory[i + 1];
    if (cur.game_id === next.game_id && cur.merchant_id === next.merchant_id && cur.source_code === next.source_code) {
      const tCur = new Date(cur.recorded_at).getTime();
      const tNext = new Date(next.recorded_at).getTime();
      if (Math.abs(tNext - tCur) <= 60000 && Math.abs(cur.price_eur - next.price_eur) > 0.01) {
        contaminatedStreams.add(`${cur.game_id}_${cur.merchant_id}_${cur.source_code}`);
      }
    }
  }
  console.log(`Identified ${contaminatedStreams.size} contaminated streams exhibiting multi-edition ping-pong.`);

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

  let ambiguousEventsCount = 0;

  for (const row of allHistory) {
    const rawStreamKey = `${row.game_id}_${row.merchant_id}_${row.source_code}`;
    const isContaminated = contaminatedStreams.has(rawStreamKey);

    const storedEvent = row.price_event || 'NONE';
    const storedEditionKey = row.edition_key || 'standard';
    const storedEditionName = row.edition_name || 'Standard Edition';
    const storedConfidence = row.identity_confidence || 'CONFIDENT';

    let correctedEvent = 'NONE';
    let correctedEditionKey = storedEditionKey;
    let correctedEditionName = storedEditionName;
    let correctedConfidence = storedConfidence;

    if (isContaminated) {
      // Ambiguous multi-edition stream where edition was never recorded
      ambiguousEventsCount++;
      correctedConfidence = 'AMBIGUOUS';
      correctedEvent = 'NONE';
    } else {
      // Clean uncontaminated stream
      correctedConfidence = 'CONFIDENT';
      correctedEditionKey = 'standard';
      correctedEditionName = 'Standard Edition';

      const previousPriceEur = streamPrevious.get(rawStreamKey);
      streamPrevious.set(rawStreamKey, row.price_eur);

      const game = gamesMap.get(row.game_id);
      const isOfficial = merchantsMap.get(row.merchant_id) || false;

      correctedEvent = detectPriceEvent({
        currentPriceEur: row.price_eur,
        previousPriceEur,
        basePriceEur: game?.base_price_eur,
        historicalLowEur: game?.historical_low_eur,
        isOfficialMerchant: isOfficial
      }, Boolean(row.is_pricing_error));
    }

    const isStoredDrop = !['NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER'].includes(storedEvent);
    const isCorrectedDrop = correctedConfidence === 'CONFIDENT' && !['NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER'].includes(correctedEvent);

    if (isStoredDrop) {
      if (row.recorded_at >= oneDayAgo) storedDrops1d.add(row.game_id);
      if (row.recorded_at >= threeDaysAgo) storedDrops3d.add(row.game_id);
      if (row.recorded_at >= sevenDaysAgo) storedDrops7d.add(row.game_id);
    }

    if (isCorrectedDrop) {
      if (row.recorded_at >= oneDayAgo) correctedDrops1d.add(row.game_id);
      if (row.recorded_at >= threeDaysAgo) correctedDrops3d.add(row.game_id);
      if (row.recorded_at >= sevenDaysAgo) correctedDrops7d.add(row.game_id);
    }

    const hasEventChanged = storedEvent !== correctedEvent;
    const hasConfidenceChanged = storedConfidence !== correctedConfidence;
    const hasEditionChanged = storedEditionKey !== correctedEditionKey;

    if (hasEventChanged || hasConfidenceChanged || hasEditionChanged) {
      affectedGames.add(row.game_id);
      const key = `${storedEvent} -> ${correctedEvent}${correctedConfidence === 'AMBIGUOUS' ? ' [AMBIGUOUS]' : ''}`;
      transitionMatrix[key] = (transitionMatrix[key] || 0) + 1;
      changes.push({
        id: row.id,
        gameId: row.game_id,
        storedEvent,
        correctedEvent,
        storedEditionKey,
        correctedEditionKey,
        storedEditionName,
        correctedEditionName,
        storedConfidence,
        correctedConfidence
      });
    }
  }

  // Check Dual ATL invariant
  const atlViolations = db.prepare(`
    SELECT id, steam_app_id, title, official_historical_low_eur, official_historical_low_date, official_historical_low_source,
           historical_low_eur, historical_low_date, historical_low_source, atl_is_confirmed
    FROM games 
    WHERE official_historical_low_eur IS NOT NULL 
      AND official_historical_low_eur > 0
      AND (historical_low_eur IS NULL OR historical_low_eur > official_historical_low_eur)
  `).all();

  console.log(`\n--- RECLASSIFICATION AUDIT METRICS ---`);
  console.log(`Total records evaluated:              ${allHistory.length}`);
  console.log(`Total records to update:              ${changes.length} (${((changes.length / allHistory.length) * 100).toFixed(2)}%)`);
  console.log(`Ambiguous records flagged:            ${ambiguousEventsCount}`);
  console.log(`Unique games affected:                ${affectedGames.size} (${((affectedGames.size / gamesMap.size) * 100).toFixed(1)}% of all games)`);

  console.log(`\n--- DUAL ALL-TIME LOW INVARIANT AUDIT ---`);
  console.log(`Games with historical_low_eur > official_historical_low_eur: ${atlViolations.length}`);
  for (const v of atlViolations) {
    console.log(`  - [App ${v.steam_app_id}] ${v.title}: official=${v.official_historical_low_eur}€, overall=${v.historical_low_eur}€`);
  }

  console.log(`\n--- TOP TRANSITIONS (Stored -> Corrected) ---`);
  const sortedTransitions = Object.entries(transitionMatrix).sort((a, b) => b[1] - a[1]);
  for (const [trans, count] of sortedTransitions.slice(0, 15)) {
    console.log(`  ${trans.padEnd(45)} : ${count}`);
  }

  console.log(`\n--- FRESH DROPS IMPACT (Stored Feed vs Corrected Feed) ---`);
  console.log(`  • 1-Day Window (< 24h): Stored=${storedDrops1d.size} games -> Corrected=${correctedDrops1d.size} games (-${storedDrops1d.size - correctedDrops1d.size} false alarms, -${storedDrops1d.size > 0 ? (((storedDrops1d.size - correctedDrops1d.size) / storedDrops1d.size) * 100).toFixed(1) : 0}%)`);
  console.log(`  • 3-Day Window (< 72h): Stored=${storedDrops3d.size} games -> Corrected=${correctedDrops3d.size} games (-${storedDrops3d.size - correctedDrops3d.size} false alarms, -${storedDrops3d.size > 0 ? (((storedDrops3d.size - correctedDrops3d.size) / storedDrops3d.size) * 100).toFixed(1) : 0}%)`);
  console.log(`  • 7-Day Window (< 7d):  Stored=${storedDrops7d.size} games -> Corrected=${correctedDrops7d.size} games (-${storedDrops7d.size - correctedDrops7d.size} false alarms, -${storedDrops7d.size > 0 ? (((storedDrops7d.size - correctedDrops7d.size) / storedDrops7d.size) * 100).toFixed(1) : 0}%)`);

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
        original_edition_key TEXT,
        reclassified_edition_key TEXT,
        original_edition_name TEXT,
        reclassified_edition_name TEXT,
        original_identity_confidence TEXT,
        reclassified_identity_confidence TEXT,
        updated_at TEXT NOT NULL
      )
    `).run();

    // 2. Insert backups and update price_history in batches
    const insertBackupStmt = db.prepare(`
      INSERT OR REPLACE INTO price_history_event_backup (
        id, original_price_event, reclassified_price_event,
        original_edition_key, reclassified_edition_key,
        original_edition_name, reclassified_edition_name,
        original_identity_confidence, reclassified_identity_confidence,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateEventStmt = db.prepare(`
      UPDATE price_history 
      SET price_event = ?, edition_key = ?, edition_name = ?, identity_confidence = ? 
      WHERE id = ?
    `);

    for (const change of changes) {
      insertBackupStmt.run(
        change.id, change.storedEvent, change.correctedEvent,
        change.storedEditionKey, change.correctedEditionKey,
        change.storedEditionName, change.correctedEditionName,
        change.storedConfidence, change.correctedConfidence,
        nowIso
      );
      updateEventStmt.run(
        change.correctedEvent, change.correctedEditionKey, change.correctedEditionName, change.correctedConfidence, 
        change.id
      );
    }
    console.log(`[APPLY] Updated ${changes.length} records in price_history and stored in backup table.`);

    // 3. Heal Dual ATL Invariant Violations
    if (atlViolations.length > 0) {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS games_atl_backup (
          id TEXT PRIMARY KEY,
          original_historical_low_eur REAL,
          original_historical_low_date TEXT,
          original_historical_low_source TEXT,
          original_atl_is_confirmed INTEGER,
          healed_historical_low_eur REAL,
          updated_at TEXT NOT NULL
        )
      `).run();

      const insertAtlBackupStmt = db.prepare(`
        INSERT OR REPLACE INTO games_atl_backup (
          id, original_historical_low_eur, original_historical_low_date, 
          original_historical_low_source, original_atl_is_confirmed, healed_historical_low_eur, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const healAtlStmt = db.prepare(`
        UPDATE games
        SET historical_low_eur = official_historical_low_eur,
            historical_low_date = COALESCE(official_historical_low_date, historical_low_date),
            historical_low_source = COALESCE(official_historical_low_source, historical_low_source),
            atl_is_confirmed = 1,
            updated_at = datetime('now')
        WHERE id = ?
      `);

      for (const v of atlViolations) {
        insertAtlBackupStmt.run(
          v.id, v.historical_low_eur, v.historical_low_date, 
          v.historical_low_source, v.atl_is_confirmed, v.official_historical_low_eur, nowIso
        );
        healAtlStmt.run(v.id);
      }
      console.log(`[APPLY] Healed ${atlViolations.length} games with dual ATL invariant violations and created games_atl_backup.`);
    }
  });

  applyTx();
  console.log(`\n[APPLY SUCCESS] Transaction committed. All changes are backed up and fully reversible.`);
  console.log(`To rollback at any time, run:`);
  console.log(`  node scripts/repair-historical-price-events.cjs "${dbPath}" --rollback\n`);
}

run();
