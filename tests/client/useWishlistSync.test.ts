// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWishlistSync } from '../../src/client/src/hooks/useWishlistSync.js';
import { MockEventSource } from '../setupClient.js';
import type { SyncProgressUpdate } from '../../src/client/src/types.js';

describe('useWishlistSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to SSE and updates syncProgress', () => {
    const { result } = renderHook(() => useWishlistSync());

    expect(MockEventSource.instances.length).toBe(1);
    const sse = MockEventSource.instances[0];

    const update: SyncProgressUpdate = {
      status: 'RUNNING',
      totalGames: 100,
      processedGames: 20,
      currentAction: 'Syncing Steam Store...',
      sourceProgress: {} as any
    };

    act(() => {
      sse.emitMessage(update);
    });

    expect(result.current.syncProgress).toEqual(update);
  });

  it('triggers onSyncCompleted on COMPLETED status', () => {
    const onSyncCompleted = vi.fn();
    renderHook(() => useWishlistSync(onSyncCompleted));

    const sse = MockEventSource.instances[0];
    const update: SyncProgressUpdate = {
      status: 'COMPLETED',
      totalGames: 100,
      processedGames: 100,
      currentAction: 'Sync Finished',
      sourceProgress: {} as any
    };

    act(() => {
      sse.emitMessage(update);
    });

    expect(onSyncCompleted).toHaveBeenCalledTimes(1);
  });

  it('triggers onSyncCompleted on COMPLETED_WITH_WARNINGS status', () => {
    const onSyncCompleted = vi.fn();
    renderHook(() => useWishlistSync(onSyncCompleted));

    const sse = MockEventSource.instances[0];
    const update: SyncProgressUpdate = {
      status: 'COMPLETED_WITH_WARNINGS',
      totalGames: 100,
      processedGames: 95,
      currentAction: 'Sync Finished (with warnings)',
      sourceProgress: {} as any
    };

    act(() => {
      sse.emitMessage(update);
    });

    expect(onSyncCompleted).toHaveBeenCalledTimes(1);
  });

  it('does NOT trigger onSyncCompleted on RUNNING or FAILED status', () => {
    const onSyncCompleted = vi.fn();
    renderHook(() => useWishlistSync(onSyncCompleted));

    const sse = MockEventSource.instances[0];

    act(() => {
      sse.emitMessage({
        status: 'RUNNING',
        totalGames: 10,
        processedGames: 1,
        currentAction: 'Running...',
        sourceProgress: {} as any
      });
    });
    expect(onSyncCompleted).not.toHaveBeenCalled();

    act(() => {
      sse.emitMessage({
        status: 'FAILED',
        totalGames: 10,
        processedGames: 1,
        currentAction: 'Failed',
        sourceProgress: {} as any
      });
    });
    expect(onSyncCompleted).not.toHaveBeenCalled();
  });

  it('auto-dismisses syncProgress after 10 seconds for terminal statuses', () => {
    const terminalStatuses: SyncProgressUpdate['status'][] = [
      'COMPLETED',
      'COMPLETED_WITH_WARNINGS',
      'FAILED',
      'CANCELLED'
    ];

    for (const status of terminalStatuses) {
      const { result } = renderHook(() => useWishlistSync());
      const sse = MockEventSource.instances[MockEventSource.instances.length - 1];

      act(() => {
        sse.emitMessage({
          status,
          totalGames: 10,
          processedGames: 10,
          currentAction: `Status is ${status}`,
          sourceProgress: {} as any
        });
      });

      expect(result.current.syncProgress?.status).toBe(status);

      // Fast forward 9.9 seconds -> still present
      act(() => {
        vi.advanceTimersByTime(9900);
      });
      expect(result.current.syncProgress).not.toBeNull();

      // Fast forward 100ms -> 10s elapsed, auto-dismissed to null
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.syncProgress).toBeNull();
    }
  });

  it('does NOT auto-dismiss RUNNING status after 10 seconds', () => {
    const { result } = renderHook(() => useWishlistSync());
    const sse = MockEventSource.instances[0];

    act(() => {
      sse.emitMessage({
        status: 'RUNNING',
        totalGames: 10,
        processedGames: 5,
        currentAction: 'Syncing...',
        sourceProgress: {} as any
      });
    });

    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(result.current.syncProgress).not.toBeNull();
    expect(result.current.syncProgress?.status).toBe('RUNNING');
  });
});
