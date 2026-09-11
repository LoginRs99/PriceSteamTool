import { useState, useEffect, useCallback, useRef } from 'react';
import type { SyncProgressUpdate, SourceCode } from '../types.js';
import { api } from '../api.js';

const TERMINAL_STATUSES = ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED'] as const;

export function useWishlistSync(onSyncCompleted?: () => void) {
  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);

  const onSyncCompletedRef = useRef(onSyncCompleted);
  useEffect(() => {
    onSyncCompletedRef.current = onSyncCompleted;
  });

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    const eventSource = new EventSource('/api/sync/events');
    eventSource.onmessage = (event) => {
      try {
        const update: SyncProgressUpdate = JSON.parse(event.data);
        setSyncProgress(update);

        if ((update.status === 'COMPLETED' || update.status === 'COMPLETED_WITH_WARNINGS') && onSyncCompletedRef.current) {
          onSyncCompletedRef.current();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (!syncProgress || !TERMINAL_STATUSES.includes(syncProgress.status as any)) {
      return;
    }

    const timer = setTimeout(() => {
      setSyncProgress(null);
    }, 10000);

    return () => {
      clearTimeout(timer);
    };
  }, [syncProgress?.status]);

  const handleExecuteSync = useCallback(async (forceRefresh: boolean, selectedSources?: SourceCode[]) => {
    try {
      await api.startSync({ forceRefresh, sources: selectedSources });
    } catch (err: any) {
      alert(err.message || 'Failed to start sync');
    }
  }, []);

  const handleCancelSync = useCallback(async () => {
    try {
      await api.cancelSync();
    } catch (err: any) {
      console.error('Failed to cancel sync:', err);
    }
  }, []);

  return {
    syncProgress,
    handleExecuteSync,
    handleCancelSync
  };
}
