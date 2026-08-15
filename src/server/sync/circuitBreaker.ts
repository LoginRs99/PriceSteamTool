import { sourceRepo } from '../db/index.js';
import type { SourceCode, CircuitState } from '../../shared/types.js';

interface CircuitStateInfo {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveRateLimits: number;
  cooldownUntil: number | null;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
}

export class CircuitBreakerRegistry {
  private states = new Map<SourceCode, CircuitStateInfo>();
  private initialized = false;

  constructor() {}

  private initFromDb(): void {
    if (this.initialized) return;
    try {
      const dbSources = sourceRepo.list();
      for (const s of dbSources) {
        const cooldownTime = s.cooldownUntil ? new Date(s.cooldownUntil).getTime() : null;
        this.states.set(s.code, {
          state: s.state,
          consecutiveFailures: s.failureCount > 0 ? 1 : 0,
          consecutiveRateLimits: s.rateLimitCount > 0 ? 1 : 0,
          cooldownUntil: cooldownTime,
          lastFailureTime: null,
          lastSuccessTime: s.lastSuccessAt ? new Date(s.lastSuccessAt).getTime() : null,
        });
      }
      this.initialized = true;
    } catch (e) {
      // If DB is not ready yet, lazy initialize
    }
  }

  private getOrCreate(source: SourceCode): CircuitStateInfo {
    this.initFromDb();
    let info = this.states.get(source);
    if (!info) {
      info = {
        state: 'NORMAL',
        consecutiveFailures: 0,
        consecutiveRateLimits: 0,
        cooldownUntil: null,
        lastFailureTime: null,
        lastSuccessTime: null,
      };
      this.states.set(source, info);
    }
    return info;
  }

  public canExecute(source: SourceCode): { allowed: boolean; reason?: string } {
    const info = this.getOrCreate(source);
    const now = Date.now();

    if (info.state === 'NORMAL') {
      return { allowed: true };
    }

    if (info.state === 'BACKOFF') {
      if (info.cooldownUntil && now >= info.cooldownUntil) {
        info.state = 'COOLDOWN'; // probe
        sourceRepo.updateCircuitState(source, 'COOLDOWN');
        return { allowed: true };
      }
      const remainingSecs = info.cooldownUntil ? Math.max(1, Math.ceil((info.cooldownUntil - now) / 1000)) : 0;
      return { allowed: false, reason: `Source ${source} is in BACKOFF cooldown (${remainingSecs}s remaining)` };
    }

    if (info.state === 'PAUSED') {
      if (info.cooldownUntil && now >= info.cooldownUntil) {
        info.state = 'COOLDOWN'; // single probe attempt
        sourceRepo.updateCircuitState(source, 'COOLDOWN');
        return { allowed: true };
      }
      const remainingSecs = info.cooldownUntil ? Math.max(1, Math.ceil((info.cooldownUntil - now) / 1000)) : 0;
      return { allowed: false, reason: `Source ${source} is PAUSED (${remainingSecs}s remaining)` };
    }

    if (info.state === 'COOLDOWN') {
      return { allowed: true }; // Probe request allowed
    }

    return { allowed: true };
  }

  public recordSuccess(source: SourceCode): void {
    const info = this.getOrCreate(source);
    info.state = 'NORMAL';
    info.consecutiveFailures = 0;
    info.consecutiveRateLimits = 0;
    info.cooldownUntil = null;
    info.lastSuccessTime = Date.now();
    
    sourceRepo.updateCircuitState(source, 'NORMAL');
    sourceRepo.incrementCounters(source, 'success');
  }

  public recordRateLimit(source: SourceCode, retryAfterSec: number = 30): void {
    const info = this.getOrCreate(source);
    info.consecutiveRateLimits++;
    info.lastFailureTime = Date.now();

    const cooldownMs = Math.max(retryAfterSec * 1000, 30000);
    info.cooldownUntil = Date.now() + cooldownMs;

    if (info.consecutiveRateLimits >= 3 || info.state === 'COOLDOWN') {
      info.state = 'PAUSED';
      info.cooldownUntil = Date.now() + (15 * 60 * 1000); // 15 minutes
    } else {
      info.state = 'BACKOFF';
    }

    sourceRepo.updateCircuitState(source, info.state, new Date(info.cooldownUntil).toISOString());
    sourceRepo.incrementCounters(source, 'ratelimit', `Rate limit 429 hit. Pausing for ${Math.round(cooldownMs / 1000)}s`);
  }

  public recordFailure(source: SourceCode, error: string): void {
    const info = this.getOrCreate(source);
    info.consecutiveFailures++;
    info.lastFailureTime = Date.now();

    // If probe failed during COOLDOWN, immediately return to PAUSED with doubled penalty
    if (info.state === 'COOLDOWN') {
      info.state = 'PAUSED';
      info.cooldownUntil = Date.now() + (30 * 60 * 1000); // 30 minutes
    } else if (info.consecutiveFailures >= 4) {
      info.state = 'PAUSED';
      info.cooldownUntil = Date.now() + (30 * 60 * 1000); // 30 minutes
    } else if (info.consecutiveFailures >= 2) {
      info.state = 'BACKOFF';
      info.cooldownUntil = Date.now() + (30 * 1000); // 30 seconds
    }

    const cooldownIso = info.cooldownUntil ? new Date(info.cooldownUntil).toISOString() : undefined;
    sourceRepo.updateCircuitState(source, info.state, cooldownIso);
    sourceRepo.incrementCounters(source, 'failure', error);
  }

  public getState(source: SourceCode): CircuitState {
    return this.getOrCreate(source).state;
  }
}

export const circuitBreakers = new CircuitBreakerRegistry();
