import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import { 
  createDatabaseBackup, 
  rotateBackups, 
  listBackups 
} from '../../src/server/db/backup.js';

describe('Database Online Backup & Retention Suite', () => {
  let tempDir: string;
  let testDbPath: string;
  let testDb: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricetool-backup-test-'));
    testDbPath = path.join(tempDir, 'source.db');
    testDb = new Database(testDbPath);
    testDb.pragma('journal_mode = WAL');
    testDb.exec(`
      CREATE TABLE test_data (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO test_data (name) VALUES ('Test Game 1'), ('Test Game 2');
    `);
  });

  afterEach(() => {
    try { testDb.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('creates an intact online backup using atomic .tmp promotion', async () => {
    const backupDir = path.join(tempDir, 'backups');
    const result = await createDatabaseBackup(testDb, { backupDir, retentionCount: 5 });

    expect(result.success).toBe(true);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);

    // Ensure no leftover .tmp files
    const allFiles = fs.readdirSync(backupDir);
    const tmpFiles = allFiles.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles.length).toBe(0);

    // Verify backup contents with readonly database connection
    const backupDb = new Database(result.backupPath, { readonly: true });
    const rows = backupDb.prepare('SELECT * FROM test_data ORDER BY id ASC').all() as any[];
    backupDb.close();

    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Test Game 1');
    expect(rows[1].name).toBe('Test Game 2');
  });

  it('lists existing backups sorted newest first', async () => {
    const backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Mock 3 backup files
    const file1 = path.join(backupDir, 'pricetool-backup-2026-01-01T10-00-00.000Z.db');
    const file2 = path.join(backupDir, 'pricetool-backup-2026-01-02T10-00-00.000Z.db');
    const file3 = path.join(backupDir, 'pricetool-backup-2026-01-03T10-00-00.000Z.db');

    fs.writeFileSync(file1, 'data1');
    fs.writeFileSync(file2, 'data2');
    fs.writeFileSync(file3, 'data3');

    const list = listBackups(backupDir);
    expect(list.length).toBe(3);
    expect(list[0].fileName).toBe('pricetool-backup-2026-01-03T10-00-00.000Z.db');
    expect(list[1].fileName).toBe('pricetool-backup-2026-01-02T10-00-00.000Z.db');
    expect(list[2].fileName).toBe('pricetool-backup-2026-01-01T10-00-00.000Z.db');
  });

  it('rotates older backups exceeding retention policy', () => {
    const backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const file1 = path.join(backupDir, 'pricetool-backup-2026-01-01T10-00-00.000Z.db');
    const file2 = path.join(backupDir, 'pricetool-backup-2026-01-02T10-00-00.000Z.db');
    const file3 = path.join(backupDir, 'pricetool-backup-2026-01-03T10-00-00.000Z.db');

    fs.writeFileSync(file1, 'data1');
    fs.writeFileSync(file2, 'data2');
    fs.writeFileSync(file3, 'data3');

    const { prunedCount, prunedFiles } = rotateBackups(backupDir, 2);
    expect(prunedCount).toBe(1);
    expect(prunedFiles).toEqual(['pricetool-backup-2026-01-01T10-00-00.000Z.db']);
    expect(fs.existsSync(file1)).toBe(false);
    expect(fs.existsSync(file2)).toBe(true);
    expect(fs.existsSync(file3)).toBe(true);
  });

  it('cleans up temporary files if snapshot integrity check fails', async () => {
    const backupDir = path.join(tempDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Mock a db whose backup method outputs corrupted bytes
    const brokenDb = {
      pragma: () => {},
      backup: async (destPath: string) => {
        fs.writeFileSync(destPath, 'NOT_A_VALID_SQLITE_DATABASE');
      }
    } as any;

    await expect(createDatabaseBackup(brokenDb, { backupDir })).rejects.toThrow();

    // Verify neither .tmp nor .db remains in backupDir
    const entries = fs.readdirSync(backupDir);
    expect(entries.length).toBe(0);
  });
});
