import { describe, it, expect, vi, beforeEach } from 'vitest';
import { circuitBreakers, CircuitBreakerRegistry } from '../../src/server/sync/circuitBreaker.js';
import { PacedSourceQueue } from '../../src/server/sync/rateLimiter.js';
import { safeFetchJson } from '../../src/server/sources/base.js';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { ggdealsAdapter } from '../../src/server/sources/ggdeals.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { syncRunRepo } from '../../src/server/db/repositories/syncRun.js';

describe('Sync Engine & API Resilience Audit Suite', () => {
  beforeEach(() => {
    for (const source of ['steam', 'itad', 'cheapshark', 'ggdeals', 'nexarda', 'superduperbundle'] as const) {
      circuitBreakers.reset(source);
      circuitBreakers.clearCooldown(source);
    }
  });

  describe('1. Circuit Breaker Failure & Rate Limit Count Decay', () => {
    it('decays consecutive failure count when previous failure is older than 15 minutes', () => {
      const cb = new CircuitBreakerRegistry();
      const now = Date.now();

      // First failure at T - 20 minutes
      const info = (cb as any).getOrCreate('itad');
      info.consecutiveFailures = 1;
      info.lastFailureTime = now - 20 * 60 * 1000;

      // New failure occurs now
      cb.recordFailure('itad', 'Network blip');

      // The 1st failure decayed; consecutiveFailures should be 1 (not 2, which would trip BACKOFF)
      expect(cb.getConsecutiveFailures('itad')).toBe(1);
      expect(cb.getState('itad')).toBe('NORMAL');
    });

    it('retains consecutive failure count when failures are within 15-minute window', () => {
      const cb = new CircuitBreakerRegistry();
      const now = Date.now();

      // First failure at T - 2 minutes
      const info = (cb as any).getOrCreate('itad');
      info.consecutiveFailures = 1;
      info.lastFailureTime = now - 2 * 60 * 1000;

      // Second failure occurs within window
      cb.recordFailure('itad', 'Network blip 2');

      // Threshold of 2 reached -> trips BACKOFF
      expect(cb.getConsecutiveFailures('itad')).toBe(2);
      expect(cb.getState('itad')).toBe('BACKOFF');
    });
  });

  describe('2. Client Cancellation Safety (Circuit Breakers)', () => {
    it('does not record a circuit breaker failure when a task in PacedSourceQueue is cancelled or aborted', async () => {
      const queue = new PacedSourceQueue('cheapshark', 10, 0);

      // Enqueue a task that throws an AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const taskPromise = queue.enqueue(async () => {
        throw abortError;
      });

      await expect(taskPromise).rejects.toThrow('The operation was aborted');

      // CheapShark consecutive failures should not be incremented for client aborts
      expect(circuitBreakers.getConsecutiveFailures('cheapshark')).toBe(0);
      expect(circuitBreakers.getState('cheapshark')).toBe('NORMAL');
    });

  });

  describe('3. Batch Queue Draining & Cancel Safety', () => {
    it('immediately aborts CheapShark batch chunk loop on clearQueue', async () => {
      (cheapsharkAdapter as any).storesMap.set('1', 'Steam');
      (cheapsharkAdapter as any).lastStoreFetch = Date.now();

      let fetchDealCalls = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchDealCalls++;
        // Trigger cancelSync / clearQueue on the first chunk
        cheapsharkAdapter.clearQueue();
        return {
          ok: true,
          json: async () => []
        };
      });

      const mockGames = Array.from({ length: 100 }, (_, i) => ({
        steamAppId: 1000 + i,
        title: `Game ${i}`
      }));

      // 100 games = 4 chunks of 25. With clearQueue triggered on chunk 1, it should stop after 1 call
      const results = await cheapsharkAdapter.fetchBatchPrices(mockGames);
      expect(results.size).toBe(0);
      expect(fetchDealCalls).toBe(1); // Aborted after first chunk! Did NOT run chunks 2, 3, 4
    });

    it('immediately aborts ITAD batch loop on clearQueue', async () => {
      itadAdapter.clearQueue();
      let fetchOverviewCalls = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchOverviewCalls++;
        return {
          ok: true,
          json: async () => ({ prices: [] })
        };
      });

      const mockGames = Array.from({ length: 500 }, (_, i) => ({
        steamAppId: 2000 + i,
        title: `Game ${i}`,
        itadId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
      }));

      itadAdapter.clearQueue();
      const results = await itadAdapter.fetchBatchPrices(mockGames);
      expect(results.size).toBe(0);
      expect(fetchOverviewCalls).toBe(0);
    });

    it('immediately aborts GG.deals batch loop on clearQueue without waiting for cooldown', async () => {
      ggdealsAdapter.clearQueue();
      let fetchCalls = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        fetchCalls++;
        return {
          ok: true,
          json: async () => ({ success: true, data: {} })
        };
      });

      const mockGames = Array.from({ length: 300 }, (_, i) => ({
        steamAppId: 3000 + i,
        title: `Game ${i}`
      }));

      ggdealsAdapter.clearQueue();
      const results = await ggdealsAdapter.fetchBatchPrices(mockGames);
      expect(results.size).toBe(0);
      expect(fetchCalls).toBe(0);
    });
  });

  describe('4. CancelSync Database Persistence', () => {
    it('sets sync_runs status to CANCELLED when cancelSync is called while sync is running', () => {
      const runId = 'test-cancel-run-' + Date.now();
      syncRunRepo.create({
        id: runId,
        triggerType: 'MANUAL',
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        totalGames: 100,
        processedGames: 10,
        offersFound: 5,
        offersUpdated: 5
      });

      (syncOrchestrator as any).isRunning = true;
      (syncOrchestrator as any).activeRunId = runId;

      syncOrchestrator.cancelSync();

      const updated = syncRunRepo.getById(runId);
      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('CANCELLED');
      expect(updated?.completedAt).toBeDefined();
      expect(updated?.errorMessage).toContain('cancelled');
    });
  });

  describe('5. safeFetchJson AbortSignal Propagation', () => {
    it('fast-fails immediately without retrying when options.signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        throw new Error('fetch should not be called');
      });

      await expect(
        safeFetchJson('https://example.com/test', { signal: controller.signal }, 5000)
      ).rejects.toThrow();

      expect(attempts).toBe(0);
    });
  });
});
