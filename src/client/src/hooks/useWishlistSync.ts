import { useState, useEffect, useCallback } from 'react';
import type { SyncProgressUpdate, SourceCode } from '../types.js';
import { api } from '../api.js';

export function useWishlistSync(onSyncCompleted?: () => void) {
  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    const eventSource = new EventSource('/api/sync/events');
    eventSource.onmessage = (event) => {
      try {
        const update: SyncProgressUpdate = JSON.parse(event.data);
        setSyncProgress(update);

        if (update.status === 'COMPLETED' && onSyncCompleted) {
          onSyncCompleted();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [onSyncCompleted]);

  const handleExecuteSync = useCallback(async (forceRefresh: boolean, selectedSources?: SourceCode[]) => {
    try {
      await api.startSync({ forceRefresh, sources: selectedSources });
    } catch (err: any) {
      alert(err.message || 'Failed to start sync');
    }
  }, []);

  const handleCancelSync = useCallback(async () => {
    await api.cancelSync();
  }, []);

  return {
    syncProgress,
    handleExecuteSync,
    handleCancelSync
  };
}
