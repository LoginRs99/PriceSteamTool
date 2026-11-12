import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';

describe('Historical Repair Safety & Reversibility', () => {
  const testDbPath = path.join(os.tmpdir(), `repair_safety_test_${Date.now()}.db`);
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'repair-historical-price-events.cjs');

  function getFileHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  beforeEach(() => {
    // Initialize a test database with schema and sample records
    const db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA_SQL);

    // Seed test games and merchants
    db.prepare(`
      INSERT INTO games (id, steam_app_id, title, slug, base_price_eur, historical_low_eur, created_at, updated_at)
      VALUES ('game-1', 101, 'Test RPG', 'test-rpg', 49.99, 10.00, datetime('now'), datetime('now'))
    `).run();

    db.prepare(`
      INSERT INTO merchants (id, code, name, is_official, created_at)
      VALUES ('merch-1', 'fanatical', 'Fanatical', 1, datetime('now'))
    `).run();

    // Insert 3 price history records:
    // 1. Initial observation at €12.00
    // 2. €0.01 micro-drop from €12.00 to €11.99 (falsely stored as MAJOR_DROP)
    // 3. Genuine drop from €11.99 to €5.00 (correctly stored as EXTREME_DROP)
    const insertPh = db.prepare(`
      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, price_event, is_pricing_error, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPh.run('ph-1', 'game-1', 'merch-1', 'steam', 12.00, 'NONE', 0, '2026-11-01T10:00:00.000Z');
    insertPh.run('ph-2', 'game-1', 'merch-1', 'steam', 11.99, 'MAJOR_DROP', 0, '2026-11-02T10:00:00.000Z');
    insertPh.run('ph-3', 'game-1', 'merch-1', 'steam', 5.00, 'EXTREME_DROP', 0, '2026-11-03T10:00:00.000Z');

    // Checkpoint WAL so file hash is deterministic
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  });

  it('1. Confirms dry-run produces zero database writes (identical SHA-256 hash)', () => {
    const hashBefore = getFileHash(testDbPath);

    // Run --dry-run
    const output = execSync(`node "${scriptPath}" "${testDbPath}" --dry-run`, { encoding: 'utf-8' });
    expect(output).toContain('DRY RUN COMPLETE');
    expect(output).toContain('Zero database modifications performed');

    const hashAfter = getFileHash(testDbPath);
    expect(hashAfter).toBe(hashBefore);
  });

  it('2. Verifies apply, subsequent insertion, and surgical rollback preserving subsequent changes', () => {
    // Step A: Apply repair
    const applyOutput = execSync(`node "${scriptPath}" "${testDbPath}" --apply`, { encoding: 'utf-8' });
    expect(applyOutput).toContain('APPLY SUCCESS');

    const db = new Database(testDbPath);
    const ph2Repaired = db.prepare(`SELECT price_event, price_eur FROM price_history WHERE id = 'ph-2'`).get() as any;
    // ph-2 was €11.99 (-€0.01 micro-drop) -> must be reclassified to NONE
    expect(ph2Repaired.price_event).toBe('NONE');

    // Step B: Simulate subsequent production activity AFTER repair was applied
    // Insert brand new legitimate price history observation from a live sync
    const insertNew = db.prepare(`
      INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, price_event, is_pricing_error, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertNew.run('ph-subsequent-new', 'game-1', 'merch-1', 'steam', 4.50, 'RECORD_DROP', 0, '2026-11-10T12:00:00.000Z');

    // Also update a field unrelated to price_event on ph-1
    db.prepare(`UPDATE price_history SET deal_score = 95 WHERE id = 'ph-1'`).run();
    db.close();

    // Step C: Execute rollback
    const rollbackOutput = execSync(`node "${scriptPath}" "${testDbPath}" --rollback`, { encoding: 'utf-8' });
    expect(rollbackOutput).toContain('Rollback completed successfully');

    // Step D: Verify rollback integrity
    const dbAfterRollback = new Database(testDbPath);

    // 1. ph-2 price_event restored to its original value ('MAJOR_DROP')
    const ph2Restored = dbAfterRollback.prepare(`SELECT price_event, price_eur FROM price_history WHERE id = 'ph-2'`).get() as any;
    expect(ph2Restored.price_event).toBe('MAJOR_DROP');
    expect(ph2Restored.price_eur).toBe(11.99);

    // 2. ph-1 deal_score (95) was untouched and preserved
    const ph1 = dbAfterRollback.prepare(`SELECT price_event, deal_score FROM price_history WHERE id = 'ph-1'`).get() as any;
    expect(ph1.deal_score).toBe(95);

    // 3. Brand new record ('ph-subsequent-new') inserted after the repair was NOT deleted or altered
    const subsequentRow = dbAfterRollback.prepare(`SELECT id, price_event, price_eur FROM price_history WHERE id = 'ph-subsequent-new'`).get() as any;
    expect(subsequentRow).toBeDefined();
    expect(subsequentRow.id).toBe('ph-subsequent-new');
    expect(subsequentRow.price_event).toBe('RECORD_DROP');
    expect(subsequentRow.price_eur).toBe(4.50);

    // 4. Backup table is cleanly dropped
    const backupTable = dbAfterRollback.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='price_history_event_backup'`).get();
    expect(backupTable).toBeUndefined();

    dbAfterRollback.close();
  });
});
