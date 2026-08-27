import { circuitBreakers } from './circuitBreaker.js';
import type { SourceCode } from '../../shared/types.js';

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

/**
 * Calculates exponential-tailed jitter:
 * Most values stay close to low end, with occasional long tail.
 * Capped at 3x jitterMs to prevent pathological multi-minute delays in a single request.
 */
export function calculateExponentialJitter(jitterMs: number, randFn: () => number = Math.random): number {
  if (jitterMs <= 0) return 0;
  const u = Math.max(0.0001, Math.min(0.9999, randFn()));
  const rawJitter = -Math.log(1 - u) * (jitterMs / 2);
  return Math.floor(Math.min(rawJitter, jitterMs * 3));
}

export class PacedSourceQueue {
  private queue: QueuedTask<any>[] = [];
  private isProcessing = false;
  private lastExecutionTime = 0;

  constructor(
    public readonly sourceCode: SourceCode,
    public minIntervalMs: number,
    public jitterMs: number = 200
  ) {}

  public enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public clear(): void {
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      task?.reject(new Error(`Queue for ${this.sourceCode} was cleared/cancelled`));
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const check = circuitBreakers.canExecute(this.sourceCode);
      if (!check.allowed) {
        // If paused or in backoff, pause execution without discarding queued tasks
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const now = Date.now();
      const jitter = calculateExponentialJitter(this.jitterMs);
      const elapsed = now - this.lastExecutionTime;
      const waitTime = Math.max(0, (this.minIntervalMs + jitter) - elapsed);

      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }

      const task = this.queue.shift();
      if (!task) break;

      this.lastExecutionTime = Date.now();
      try {
        const result = await task.fn();
        circuitBreakers.recordSuccess(this.sourceCode);
        task.resolve(result);
      } catch (err: any) {
        if (err?.status === 429 || err?.message?.includes('429') || err?.response?.status === 429) {
          const retryAfter = err?.retryAfterSec ?? 30;
          circuitBreakers.recordRateLimit(this.sourceCode, retryAfter);
        } else {
          circuitBreakers.recordFailure(this.sourceCode, err?.message || 'Unknown network failure');
        }
        task.reject(err);
      }
    }

    this.isProcessing = false;
  }
}
