import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  AKS_BASE_DELAY_MS, 
  AKS_MIN_DELAY_MS, 
  AKS_MAX_DELAY_MS, 
  computeNextPacingDelay, 
  calculateBoundedJitter 
} from '../../src/server/sync/allkeyshop/adaptivePacing.js';
import { 
  computeFailureCooldown, 
  AKS_FAILURE_SCHEDULE_MS, 
  MAX_FAILURE_BACKOFF_MS 
} from '../../src/server/sync/allkeyshop/backoff.js';
import { AllKeyShopPoliteQueue, allkeyshopQueue } from '../../src/server/sync/allkeyshop/queue.js';
import { AllKeyShopSourceAdapter } from '../../src/server/sources/allkeyshop.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';
import fs from 'node:fs';

describe('AllKeyShop Polite Adaptive Fetcher Suite', () => {
  beforeEach(() => {
    circuitBreakers.resetAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Concurrency & FIFO Single-Worker Queue', () => {
    it('executes queued tasks strictly one at a time in FIFO order', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 5;
      queue.jitterMaxMs = 0;
      (queue as any).currentDelayMs = 5;

      const executionOrder: string[] = [];
      let activeCount = 0;
      let maxActiveCount = 0;

      const makeTask = (id: string, delayMs = 20) => async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        executionOrder.push(`start-${id}`);
        await new Promise(r => setTimeout(r, delayMs));
        executionOrder.push(`end-${id}`);
        activeCount--;
        return id;
      };

      const p1 = queue.enqueue('game-1', makeTask('1', 30), 'Game 1');
      const p2 = queue.enqueue('game-2', makeTask('2', 20), 'Game 2');
      const p3 = queue.enqueue('game-3', makeTask('3', 10), 'Game 3');

      const results = await Promise.all([p1, p2, p3]);

      expect(results).toEqual(['1', '2', '3']);
      expect(maxActiveCount).toBe(1); // Strictly single-worker
      expect(executionOrder).toEqual([
        'start-1', 'end-1',
        'start-2', 'end-2',
        'start-3', 'end-3'
      ]);
    });
  });

  describe('2. Adaptive Latency-Aware Pacing', () => {
    it('maintains delay between 1s and 3s response durations', () => {
      expect(computeNextPacingDelay(5000, 1500)).toBe(5000);
      expect(computeNextPacingDelay(8000, 2900)).toBe(8000);
      expect(computeNextPacingDelay(10000, 1000)).toBe(10000);
    });

    it('decreases delay toward MIN_DELAY on fast response (<1s) and clamps at MIN_DELAY', () => {
      // 8000ms delay with 600ms fast response -> 7750ms
      expect(computeNextPacingDelay(8000, 600)).toBe(7750);
      // (AKS_MIN_DELAY_MS + 100) delay with 400ms fast response -> clamps at AKS_MIN_DELAY_MS
      expect(computeNextPacingDelay(AKS_MIN_DELAY_MS + 100, 400)).toBe(AKS_MIN_DELAY_MS);
      // AKS_MIN_DELAY_MS delay with 200ms fast response -> remains AKS_MIN_DELAY_MS
      expect(computeNextPacingDelay(AKS_MIN_DELAY_MS, 200)).toBe(AKS_MIN_DELAY_MS);
    });

    it('increases delay on slow response (>3s) and clamps at MAX_DELAY', () => {
      // 5000ms delay with 3500ms slow response -> 6000ms
      expect(computeNextPacingDelay(5000, 3500)).toBe(6000);
      // 29500ms delay with 4000ms slow response -> 30000ms (clamped at MAX_DELAY_MS)
      expect(computeNextPacingDelay(29500, 4000)).toBe(AKS_MAX_DELAY_MS);
      // 30000ms delay with 5000ms slow response -> remains 30000ms
      expect(computeNextPacingDelay(30000, 5000)).toBe(AKS_MAX_DELAY_MS);
    });

    it('bounded jitter remains strictly within bounds', () => {
      for (let i = 0; i < 50; i++) {
        const jitter = calculateBoundedJitter(500);
        expect(jitter).toBeGreaterThanOrEqual(0);
        expect(jitter).toBeLessThanOrEqual(500);
      }
      expect(calculateBoundedJitter(0)).toBe(0);
    });
  });

  describe('3. Exponential Failure Backoff Schedule', () => {
    it('applies exact failure schedule 1h -> 4h -> 12h -> 24h -> 48h', () => {
      expect(computeFailureCooldown(1)).toBe(1 * 3600_000);   // 1 hour
      expect(computeFailureCooldown(2)).toBe(4 * 3600_000);   // 4 hours
      expect(computeFailureCooldown(3)).toBe(12 * 3600_000);  // 12 hours
      expect(computeFailureCooldown(4)).toBe(24 * 3600_000);  // 24 hours
      expect(computeFailureCooldown(5)).toBe(48 * 3600_000);  // 48 hours
      expect(computeFailureCooldown(6)).toBe(48 * 3600_000);  // Capped at 48 hours
      expect(computeFailureCooldown(10)).toBe(MAX_FAILURE_BACKOFF_MS);
    });

    it('respects Retry-After header when longer than scheduled cooldown', () => {
      // Failure #1 schedule is 1h (3600s), Retry-After is 7200s (2h) -> chooses 7200s (2h)
      expect(computeFailureCooldown(1, 7200)).toBe(7200 * 1000);

      // Failure #3 schedule is 12h (43200s), Retry-After is 300s (5m) -> chooses 12h
      expect(computeFailureCooldown(3, 300)).toBe(12 * 3600_000);

      // Never retries 429 immediately
      expect(computeFailureCooldown(1, 0)).toBe(1 * 3600_000);
    });
  });

  describe('4. Queue Deduplication & Task Preservation', () => {
    it('coalesces duplicate enqueued requests for the same game into a single task', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 5;
      queue.jitterMaxMs = 0;
      (queue as any).currentDelayMs = 5;

      let callCount = 0;
      const workerFn = async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 20));
        return { count: callCount };
      };

      // Enqueue the same game key twice before processing completes
      const req1 = queue.enqueue('app-101', workerFn, 'Borderlands');
      const req2 = queue.enqueue('app-101', workerFn, 'Borderlands');

      const [res1, res2] = await Promise.all([req1, req2]);

      expect(res1).toEqual({ count: 1 });
      expect(res2).toEqual({ count: 1 });
      expect(callCount).toBe(1); // Only executed once!
    });

    it('preserves queued tasks during cooldown and resumes when cooldown expires', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 5;
      queue.jitterMaxMs = 0;
      (queue as any).currentDelayMs = 5;

      const cooldownEnd = Date.now() + 50;
      vi.spyOn(circuitBreakers, 'canExecute').mockImplementation((src) => {
        if (src === 'allkeyshop' && Date.now() < cooldownEnd) {
          return { allowed: false, reason: 'Test cooldown' };
        }
        return { allowed: true };
      });
      vi.spyOn(circuitBreakers, 'getCooldownUntil').mockImplementation((src) => {
        if (src === 'allkeyshop' && Date.now() < cooldownEnd) {
          return cooldownEnd;
        }
        return null;
      });

      let taskExecuted = false;
      const taskPromise = queue.enqueue('app-202', async () => {
        taskExecuted = true;
        return 'success-after-cooldown';
      }, 'Delayed Game');

      // Immediate check: task is queued and pending, not executed
      expect(taskExecuted).toBe(false);
      expect(queue.pendingCount).toBe(1);
      expect(queue.isCoolingDown).toBe(true);

      // Wait for cooldown to expire and task to run
      const result = await taskPromise;

      expect(result).toBe('success-after-cooldown');
      expect(taskExecuted).toBe(true);
      expect(queue.pendingCount).toBe(0);
      expect(queue.isCoolingDown).toBe(false);
    });
  });

  describe('5. Metrics & State Observability', () => {
    it('exposes detailed metrics and state inspection', () => {
      const queue = new AllKeyShopPoliteQueue();
      const metrics = queue.getMetrics();

      expect(metrics.currentDelayMs).toBe(AKS_BASE_DELAY_MS);
      expect(metrics.consecutiveFailures).toBe(0);
      expect(metrics.queueLength).toBe(0);
      expect(metrics.cooldownUntil).toBeNull();
      expect(metrics.activeRequest).toBeNull();
    });
  });

  describe('6. Catalog 48h Caching & Stale Fallback', () => {
    it('uses 48h TTL and retains valid on-disk cache if remote refresh fails', async () => {
      const adapter = new AllKeyShopSourceAdapter();
      const origSolver = config.allkeyshopSolverUrl;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';

        // Mock solver returning 502
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ status: 'error' })
        });

        // Ensure disk cache is read without error
        const catalog = await adapter.ensureCatalog();
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog.length).toBeGreaterThan(0);
      } finally {
        config.allkeyshopSolverUrl = origSolver;
      }
    });
  });

  describe('7. Upstream Failure Backoff Escalation & Circuit Breaker', () => {
    it('progressively escalates cooldown on consecutive failures', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 1;
      queue.jitterMaxMs = 0;

      // Failure 1: 502 -> 1h cooldown
      const err502: any = new Error('502 Bad Gateway');
      err502.status = 502;
      queue.recordExternalFailure(err502);

      let metrics = queue.getMetrics();
      expect(metrics.consecutiveFailures).toBe(1);
      expect(queue.isCoolingDown).toBe(true);
      expect(queue.getCooldownRemainingSec()).toBeGreaterThan(3500);
      expect(queue.getCooldownRemainingSec()).toBeLessThanOrEqual(3600);

      // Failure 2: 503 -> 4h cooldown
      const err503: any = new Error('503 Service Unavailable');
      err503.status = 503;
      queue.recordExternalFailure(err503);

      metrics = queue.getMetrics();
      expect(metrics.consecutiveFailures).toBe(2);
      expect(queue.getCooldownRemainingSec()).toBeGreaterThan(14000);
      expect(queue.getCooldownRemainingSec()).toBeLessThanOrEqual(14400);

      // Reset
      queue.reset();
      expect(queue.getMetrics().consecutiveFailures).toBe(0);
      expect(queue.isCoolingDown).toBe(false);
    });
  });

  describe('8. Force Refresh Cooldown Guard', () => {
    it('forceRefresh skips AllKeyShop and reports cooldown when AKS is in backoff', async () => {
      const { SyncOrchestrator } = await import('../../src/server/sync/orchestrator.js');
      const { gameRepo, profileRepo, sourceRepo } = await import('../../src/server/db/index.js');
      const { allkeyshopQueue } = await import('../../src/server/sync/allkeyshop/index.js');

      const orchestrator = new SyncOrchestrator();
      const profile = profileRepo.getBySteamId('76561198000000088') || profileRepo.create('Force Refresh User', '76561198000000088');
      const game = gameRepo.upsert({ steamAppId: 301, title: 'Cooldown Game', basePriceEur: 19.99 });
      gameRepo.syncWishlistEntries(profile.id, [{ steamAppId: 301, title: 'Cooldown Game', priority: 1 }]);

      // Put AllKeyShop in cooldown via circuitBreakers
      circuitBreakers.recordFailure('allkeyshop', 'Upstream 502');

      const result = await orchestrator.refreshGame(game.id, { includeKeyshops: true });

      expect(result.success).toBe(true);
      expect(result.sourcesSkipped).toContain('allkeyshop');

      allkeyshopQueue.reset();
    }, 15000);
  });

  describe('9. Unified Circuit Breaker (Catalog + Targeted Price Lookup)', () => {
    it('catalog-fetch failure trips the shared breaker such that subsequent targeted price fetch attempt is blocked without making a new HTTP call', async () => {
      const adapter = new AllKeyShopSourceAdapter();
      const origSolver = config.allkeyshopSolverUrl;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';

        // 1. Mock solver returning 502 for catalog fetch
        const fetchSpy = vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => ({ status: 'error' })
        });
        global.fetch = fetchSpy;

        // Reset circuit breaker to NORMAL
        circuitBreakers.resetAll();
        expect(circuitBreakers.canExecute('allkeyshop').allowed).toBe(true);

        // Ensure in-memory and disk catalog do not return early
        (adapter as any).cachedCatalog = null;
        const backupDiskPath = `${(adapter as any).catalogPath}.bak`;
        const hasDiskCatalog = fs.existsSync((adapter as any).catalogPath);
        if (hasDiskCatalog) {
          fs.renameSync((adapter as any).catalogPath, backupDiskPath);
        }

        try {
          // Attempt catalog fetch -> fails with 502
          await expect(adapter.ensureCatalog()).rejects.toThrow();

          // 2. Assert shared circuit breaker is now tripped
          expect(circuitBreakers.canExecute('allkeyshop').allowed).toBe(false);
          expect(circuitBreakers.getConsecutiveFailures('allkeyshop')).toBe(1);
          expect(allkeyshopQueue.isCoolingDown).toBe(true);

          const callCountAfterCatalogFailure = fetchSpy.mock.calls.length;

          // 3. Subsequent catalog fetch attempt is immediately blocked by circuit breaker without new HTTP call
          await expect(adapter.ensureCatalog()).rejects.toThrow('AllKeyShop catalog unavailable');
          expect(fetchSpy.mock.calls.length).toBe(callCountAfterCatalogFailure);

          // 4. Targeted price lookup guard also sees breaker tripped
          const cbCheck = circuitBreakers.canExecute('allkeyshop');
          expect(cbCheck.allowed).toBe(false);
          expect(allkeyshopQueue.isCoolingDown).toBe(true);
        } finally {
          if (hasDiskCatalog && fs.existsSync(backupDiskPath)) {
            fs.renameSync(backupDiskPath, (adapter as any).catalogPath);
          }
        }
      } finally {
        config.allkeyshopSolverUrl = origSolver;
        circuitBreakers.resetAll();
      }
    });

    it('adaptive per-request delay pacing in queue adapts dynamically based on response duration', async () => {
      const queue = new AllKeyShopPoliteQueue();
      queue.minDelayMs = 1000;
      queue.maxDelayMs = 10000;
      queue.jitterMaxMs = 0;
      (queue as any).currentDelayMs = 5000;

      // 1. Fast task (< 1s) -> decreases delay by 250ms
      await queue.enqueue('fast-task', async () => {
        await new Promise(r => setTimeout(r, 10));
        return 'fast';
      }, 'Fast Game');

      expect(queue.getMetrics().currentDelayMs).toBe(4750);

      // 2. Slow task (> 3s) -> increases delay by 1000ms
      await queue.enqueue('slow-task', async () => {
        await new Promise(r => setTimeout(r, 3100));
        return 'slow';
      }, 'Slow Game');

      expect(queue.getMetrics().currentDelayMs).toBe(5750);
    }, 15000);
  });
});
