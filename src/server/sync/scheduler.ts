import { config } from '../config/index.js';
import { profileRepo } from '../db/index.js';
import { syncOrchestrator } from './orchestrator.js';
import { logInfo, logWarn } from '../utils/logger.js';

let timer: NodeJS.Timeout | null = null;

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
}
