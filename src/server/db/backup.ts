import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { getDb } from './core.js';
import { logInfo, logWarn } from '../utils/logger.js';

export interface BackupOptions {
  backupDir?: string;
  retentionCount?: number;
  walCheckpointMode?: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  prunedCount: number;
  prunedFiles: string[];
  durationMs: number;
}

export interface BackupFileInfo {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

const BACKUP_PREFIX = 'pricetool-backup-';
const BACKUP_EXT = '.db';
const BACKUP_FILE_REGEX = /^pricetool-backup-.*\.db$/;

/**
 * Returns the resolved default backup directory.
 */
export function getDefaultBackupDir(): string {
  return path.join(config.dataDir, 'backups');
}

/**
 * Lists existing backup files in the backup directory ordered from newest to oldest.
 */
export function listBackups(backupDir: string = getDefaultBackupDir()): BackupFileInfo[] {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const entries = fs.readdirSync(backupDir);
  const backupFiles = entries.filter(f => BACKUP_FILE_REGEX.test(f));

  const list: BackupFileInfo[] = [];
  for (const fileName of backupFiles) {
    const filePath = path.join(backupDir, fileName);
    try {
      const stats = fs.statSync(filePath);
      list.push({
        fileName,
        filePath,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString()
      });
    } catch {
      // Ignore file stat errors during concurrent operations
    }
  }

  // Sort newest first
  return list.sort((a, b) => b.fileName.localeCompare(a.fileName));
}

/**
 * Rotates backup files keeping at most `retentionCount` newest files.
 * Older files beyond `retentionCount` are safely unlinked.
 */
export function rotateBackups(
  backupDir: string = getDefaultBackupDir(),
  retentionCount: number = config.backupRetentionDays
): { prunedCount: number; prunedFiles: string[] } {
  if (!fs.existsSync(backupDir) || retentionCount <= 0) {
    return { prunedCount: 0, prunedFiles: [] };
  }

  const entries = fs.readdirSync(backupDir);
  const backupFiles = entries.filter(f => BACKUP_FILE_REGEX.test(f));

  // Sort ascending by filename (ISO timestamp guarantees chronological order)
  backupFiles.sort();

  if (backupFiles.length <= retentionCount) {
    return { prunedCount: 0, prunedFiles: [] };
  }

  const excessCount = backupFiles.length - retentionCount;
  const toDelete = backupFiles.slice(0, excessCount);
  const prunedFiles: string[] = [];

  for (const file of toDelete) {
    const filePath = path.join(backupDir, file);
    try {
      fs.unlinkSync(filePath);
      prunedFiles.push(file);
      logInfo(`[Backup] Pruned expired backup: ${file}`);
    } catch (err: any) {
      logWarn(`[Backup] Failed to prune expired backup "${file}": ${err?.message}`);
    }
  }

  return { prunedCount: prunedFiles.length, prunedFiles };
}

/**
 * Executes a consistent, online SQLite backup using the SQLite backup API.
 * Checkpoints WAL frames before taking the snapshot, verifies file integrity,
 * and prunes backups older than the retention threshold.
 */
export async function createDatabaseBackup(
  customDb?: Database.Database,
  options?: BackupOptions
): Promise<BackupResult> {
  const startTime = Date.now();
  const db = customDb || getDb();
  const backupDir = options?.backupDir || getDefaultBackupDir();
  const retentionCount = options?.retentionCount ?? config.backupRetentionDays;
  const checkpointMode = options?.walCheckpointMode ?? 'PASSIVE';

  // Ensure target backup directory exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // 1. Checkpoint WAL before backing up
  try {
    db.pragma(`wal_checkpoint(${checkpointMode})`);
  } catch (checkpointErr: any) {
    logWarn(`[Backup] WAL checkpoint (${checkpointMode}) warning: ${checkpointErr?.message}`);
  }

  // 2. Format a safe filename with ISO timestamp (substituting ':' with '-' for cross-platform filesystem compatibility)
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const fileName = `${BACKUP_PREFIX}${timestamp}${BACKUP_EXT}`;
  const backupPath = path.join(backupDir, fileName);
  const tempBackupPath = `${backupPath}.tmp`;

  // Clean up any stale temp file from previous failed run
  if (fs.existsSync(tempBackupPath)) {
    try { fs.unlinkSync(tempBackupPath); } catch {}
  }

  try {
    // 3. Online backup via better-sqlite3 backup API to temporary file
    await db.backup(tempBackupPath);

    // 4. Verify file exists and has size
    if (!fs.existsSync(tempBackupPath)) {
      throw new Error(`Backup file was not created: ${tempBackupPath}`);
    }

    const stats = fs.statSync(tempBackupPath);
    if (stats.size === 0) {
      throw new Error(`Backup file created with 0 bytes: ${tempBackupPath}`);
    }

    // 5. Verify integrity of the newly created backup snapshot
    const verifyDb = new Database(tempBackupPath, { readonly: true });
    try {
      const quickCheck = verifyDb.pragma('quick_check') as any[];
      const checkResult = quickCheck && quickCheck[0] && quickCheck[0].quick_check;
      if (checkResult !== 'ok') {
        throw new Error(`Backup integrity check failed: ${JSON.stringify(quickCheck)}`);
      }
    } finally {
      verifyDb.close();
    }

    // 6. Atomically promote verified snapshot to final backup path
    fs.renameSync(tempBackupPath, backupPath);

    // 7. Rotate backups according to retention policy
    const { prunedCount, prunedFiles } = rotateBackups(backupDir, retentionCount);

    const durationMs = Date.now() - startTime;
    const sizeKb = Math.round(stats.size / 1024);
    logInfo(`[Backup] Online database backup completed in ${durationMs}ms: ${fileName} (${sizeKb} KB) | Retention kept: ${retentionCount}, Pruned: ${prunedCount}`);

    return {
      success: true,
      backupPath,
      fileName,
      sizeBytes: stats.size,
      createdAt: new Date().toISOString(),
      prunedCount,
      prunedFiles,
      durationMs
    };
  } catch (err: any) {
    if (fs.existsSync(tempBackupPath)) {
      try { fs.unlinkSync(tempBackupPath); } catch {}
    }
    if (fs.existsSync(backupPath)) {
      try { fs.unlinkSync(backupPath); } catch {}
    }
    throw err;
  }
}
