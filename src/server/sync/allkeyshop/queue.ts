import { circuitBreakers } from '../circuitBreaker.js';
import { sourceRepo } from '../../db/index.js';
import { config } from '../../config/index.js';
import { 
  AKS_BASE_DELAY_MS, 
  computeNextPacingDelay, 
  calculateBoundedJitter 
} from './adaptivePacing.js';
import type { AllKeyShopMetrics, AllKeyShopQueueTask } from './types.js';

export class AllKeyShopPoliteQueue {
  private queue: AllKeyShopQueueTask<any>[] = [];
  private queuedKeys = new Map<string, AllKeyShopQueueTask<any>>();
  private inFlightTasks = new Map<string, Promise<any>>();
  private isProcessing = false;
  public minDelayMs = AKS_BASE_DELAY_MS;
  public maxDelayMs = 30000;
  public jitterMaxMs = config.allkeyshopJitterMs ?? 500;
  private currentDelayMs = AKS_BASE_DELAY_MS;
  private lastExecutionTime = 0;
  private activeRequestKey: string | null = null;
  private lastSuccessTimeMs: number | null = null;
  private lastFailureTimeMs: number | null = null;
  private lastCatalogRefreshMs: number | null = null;
  private wasInCooldown = false;

  constructor() {}

  public enqueue<T>(key: string, fn: () => Promise<T>, gameTitle?: string): Promise<T> {
    // 1. Queue deduplication: if identical key is already waiting in queue, coalesce promises
    const queued = this.queuedKeys.get(key);
    if (queued) {
      return new Promise<T>((resolve, reject) => {
        const prevResolve = queued.resolve;
        const prevReject = queued.reject;
        queued.resolve = (val) => {
          try { prevResolve(val); } catch {}
          resolve(val);
        };
        queued.reject = (err) => {
          try { prevReject(err); } catch {}
          reject(err);
        };
      });
    }

    // 2. In-flight coalescing: if identical key is currently running, return active promise
    const inFlight = this.inFlightTasks.get(key);
    if (inFlight) {
      return inFlight;
    }

    return new Promise<T>((resolve, reject) => {
      const task: AllKeyShopQueueTask<T> = {
        key,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        gameTitle
      };
      this.queue.push(task);
      this.queuedKeys.set(key, task);
      this.processQueue();
    });
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public get consecutiveFailures(): number {
    return circuitBreakers.getConsecutiveFailures('allkeyshop');
  }

  public get isCoolingDown(): boolean {
    const cbCheck = circuitBreakers.canExecute('allkeyshop');
    return !cbCheck.allowed;
  }

  public getCooldownRemainingSec(): number {
    const now = Date.now();
    const cbCooldown = circuitBreakers.getCooldownUntil('allkeyshop');
    if (!cbCooldown) return 0;
    const diff = cbCooldown - now;
    return diff > 0 ? Math.ceil(diff / 1000) : 0;
  }

  public recordCatalogRefresh(): void {
    this.lastCatalogRefreshMs = Date.now();
  }

  public getMetrics(): AllKeyShopMetrics {
    const cooldownUntil = circuitBreakers.getCooldownUntil('allkeyshop');
    return {
      currentDelayMs: this.currentDelayMs,
      consecutiveFailures: this.consecutiveFailures,
      cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
      queueLength: this.queue.length,
      activeRequest: this.activeRequestKey,
      lastSuccessTime: this.lastSuccessTimeMs ? new Date(this.lastSuccessTimeMs).toISOString() : null,
      lastFailureTime: this.lastFailureTimeMs ? new Date(this.lastFailureTimeMs).toISOString() : null,
      lastCatalogRefresh: this.lastCatalogRefreshMs ? new Date(this.lastCatalogRefreshMs).toISOString() : null
    };
  }

  public reset(): void {
    this.currentDelayMs = this.minDelayMs;
    this.wasInCooldown = false;
    circuitBreakers.reset('allkeyshop');
  }

  public clear(): void {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.queuedKeys.delete(task.key);
        task.reject(new Error('Queue for allkeyshop was cleared/cancelled'));
      }
    }
  }

  public recordExternalFailure(error: string | Error, retryAfterSec?: number): void {
    this.lastFailureTimeMs = Date.now();
    const errMsg = typeof error === 'string' ? error : error.message;
    const status = (error as any)?.status || (error as any)?.response?.status || (errMsg.includes('429') ? 429 : 502);

    if (status === 429) {
      circuitBreakers.recordRateLimit('allkeyshop', retryAfterSec || 30);
    } else {
      circuitBreakers.recordFailure('allkeyshop', errMsg);
    }

    const currentFailures = this.consecutiveFailures;
    const cooldownUntil = circuitBreakers.getCooldownUntil('allkeyshop');
    const cooldownMs = cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;
    const cooldownHours = (cooldownMs / 3600_000).toFixed(1);
    console.warn(`[AllKeyShop] upstream failure | status=${status} | consecutiveFailures=${currentFailures} | cooldown=${cooldownHours}h`);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Check circuit breaker status & deadline (single authority)
      const cbCheck = circuitBreakers.canExecute('allkeyshop');
      if (!cbCheck.allowed) {
        this.wasInCooldown = true;
        const cooldownUntil = circuitBreakers.getCooldownUntil('allkeyshop') || (now + 1000);
        const waitMs = Math.max(50, cooldownUntil - now);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (this.wasInCooldown) {
        console.log('[AllKeyShop] cooldown expired | resuming queued requests');
        this.wasInCooldown = false;
      }

      // Respect latency-aware pacing + jitter
      const jitter = calculateBoundedJitter(this.jitterMaxMs);
      const elapsed = Date.now() - this.lastExecutionTime;
      const waitTime = Math.max(0, (this.currentDelayMs + jitter) - elapsed);

      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }

      const task = this.queue.shift();
      if (!task) break;
      this.queuedKeys.delete(task.key);
      this.activeRequestKey = task.gameTitle || task.key;

      this.lastExecutionTime = Date.now();
      const startTime = Date.now();

      const taskExecution = (async () => {
        try {
          const result = await task.fn();
          const durationMs = Date.now() - startTime;
          const durationSec = (durationMs / 1000).toFixed(1);

          // Adjust latency-aware pacing
          this.currentDelayMs = computeNextPacingDelay(this.currentDelayMs, durationMs, this.minDelayMs, this.maxDelayMs);
          const nextDelaySec = (this.currentDelayMs / 1000).toFixed(1);

          this.lastSuccessTimeMs = Date.now();
          circuitBreakers.recordSuccess('allkeyshop');
          console.log(`[AllKeyShop] request completed | game="${task.gameTitle || task.key}" | duration=${durationSec}s | nextDelay=${nextDelaySec}s`);

          task.resolve(result);
          return result;
        } catch (err: any) {
          this.lastFailureTimeMs = Date.now();
          const status = err?.status || err?.response?.status || (err?.message?.includes('429') ? 429 : 502);
          const retryAfter = err?.retryAfterSec;

          // Record in circuit breaker (single authoritative write)
          if (status === 429) {
            circuitBreakers.recordRateLimit('allkeyshop', retryAfter || 30);
          } else {
            circuitBreakers.recordFailure('allkeyshop', err);
          }

          const currentFailures = this.consecutiveFailures;
          const cooldownUntil = circuitBreakers.getCooldownUntil('allkeyshop');
          const cooldownMs = cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;
          const cooldownHours = (cooldownMs / 3600_000).toFixed(1);
          console.warn(`[AllKeyShop] upstream failure | status=${status} | consecutiveFailures=${currentFailures} | cooldown=${cooldownHours}h`);

          task.reject(err);
          throw err;
        } finally {
          this.inFlightTasks.delete(task.key);
          this.activeRequestKey = null;
        }
      })();

      this.inFlightTasks.set(task.key, taskExecution);

      try {
        await taskExecution;
      } catch {
        // Individual task error handled above
      }
    }

    this.isProcessing = false;
  }
}

export const allkeyshopQueue = new AllKeyShopPoliteQueue();
