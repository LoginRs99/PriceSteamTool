import { config } from '../config/index.js';
import { profileRepo, offerRepo, createDatabaseBackup } from '../db/index.js';
import { syncOrchestrator } from './orchestrator.js';
import { logInfo, logWarn } from '../utils/logger.js';

let timer: NodeJS.Timeout | null = null;
let purgeTimer: NodeJS.Timeout | null = null;
let backupTimer: NodeJS.Timeout | null = null;

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day is enough

export function initAutoSyncScheduler(): void {
  if (!config.autoSyncEnabled) {
    logInfo('Automatic periodic synchronization is DISABLED (AUTO_SYNC_ENABLED=false).');
    return;
  }

  const intervalMs = config.autoSyncIntervalHours * 60 * 60 * 1000;
  logInfo(`⏰ Automatic background sync enabled: scheduled every ${config.autoSyncIntervalHours} hours.`);

  // Clear existing timer if any
  if (timer) {
    clearInterval(timer);
  }

  timer = setInterval(async () => {
    try {
      if (syncOrchestrator.isSyncRunning()) {
        logInfo('Skipping scheduled auto-sync: another sync is already in progress.');
        return;
      }

      const activeProfile = profileRepo.getActive();
      if (!activeProfile) {
        logWarn('Skipping scheduled auto-sync: no active Steam profile configured yet.');
        return;
      }

      logInfo(`⏰ Triggering scheduled periodic sync for profile "${activeProfile.name}"...`);
      await syncOrchestrator.startSync(activeProfile.id, false, undefined, 'SCHEDULED');
    } catch (err: any) {
      logWarn(`Scheduled auto-sync error: ${err.message}`);
    }
  }, intervalMs);
}

export function stopAutoSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

export function initHistoryPurgeScheduler(): void {
  if (purgeTimer) clearInterval(purgeTimer);

  const runPurge = () => {
    try {
      const { deletedCount } = offerRepo.purgeOldPriceHistory(config.historyRetentionDays);
      if (deletedCount > 0) {
        logInfo(`🧹 Purged ${deletedCount} price_history row(s) older than ${config.historyRetentionDays} days.`);
      }

      const { invalidatedCount } = offerRepo.invalidateExpiredOffers();
      if (invalidatedCount > 0) {
        logInfo(`🧹 Invalidated ${invalidatedCount} expired offer(s) not observed in >14 days.`);
      }
    } catch (err: any) {
      logWarn(`History purge error: ${err.message}`);
    }
  };

  runPurge(); // run once at startup too
  purgeTimer = setInterval(runPurge, PURGE_INTERVAL_MS);
}

export function initBackupScheduler(): void {
  if (!config.backupEnabled) {
    logInfo('💾 Automatic database backup is DISABLED (BACKUP_ENABLED=false).');
    return;
  }

  if (backupTimer) clearInterval(backupTimer);

  const intervalMs = config.backupIntervalHours * 60 * 60 * 1000;
  logInfo(`💾 Scheduled database backup enabled: every ${config.backupIntervalHours} hours (retention: ${config.backupRetentionDays} days).`);

  const runBackup = async () => {
    try {
      await createDatabaseBackup();
    } catch (err: any) {
      logWarn(`[Backup] Scheduled database backup error: ${err.message}`);
    }
  };

  backupTimer = setInterval(runBackup, intervalMs);
}

