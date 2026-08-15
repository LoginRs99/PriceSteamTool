import { circuitBreakers } from './circuitBreaker.js';
import type { SourceCode } from '../../shared/types.js';

interface QueuedTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
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
        // If paused or in backoff, reject or wait
        // Delay before re-checking
        await new Promise(r => setTimeout(r, 2000));
        const recheck = circuitBreakers.canExecute(this.sourceCode);
        if (!recheck.allowed) {
          const task = this.queue.shift();
          task?.reject(new Error(check.reason || `Source ${this.sourceCode} paused`));
          continue;
        }
      }

      const now = Date.now();
      const jitter = Math.floor(Math.random() * this.jitterMs);
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
          const retryAfter = err?.headers?.['retry-after'] ? parseInt(err.headers['retry-after'], 10) : 30;
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
