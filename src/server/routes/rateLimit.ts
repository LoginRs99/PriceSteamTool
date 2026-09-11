import { config } from '../config/index.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

interface WindowRecord {
  windowStartMs: number;
  count: number;
}

const WINDOW_MS = 60 * 1000;
const rateLimitStore = new Map<string, WindowRecord>();

/**
 * Checks and increments the fixed-window rate limit for the given key (e.g. client IP).
 * Window: 60 seconds. Limit: config.v1RateLimitPerMinute (default 300).
 * Stale entries are evicted opportunistically when the store exceeds 100 keys.
 */
export function checkRateLimit(
  key: string,
  nowMs: number = Date.now(),
  customLimit?: number
): RateLimitResult {
  const limit = customLimit ?? config.v1RateLimitPerMinute;

  // Opportunistic eviction: bound memory if map grows
  if (rateLimitStore.size > 100) {
    for (const [k, record] of rateLimitStore.entries()) {
      if (nowMs - record.windowStartMs >= WINDOW_MS) {
        rateLimitStore.delete(k);
      }
    }
  }

  let record = rateLimitStore.get(key);

  if (!record || nowMs - record.windowStartMs >= WINDOW_MS) {
    record = { windowStartMs: nowMs, count: 1 };
    rateLimitStore.set(key, record);
    const resetSeconds = Math.max(1, Math.ceil((record.windowStartMs + WINDOW_MS - nowMs) / 1000));
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetSeconds
    };
  }

  const resetSeconds = Math.max(1, Math.ceil((record.windowStartMs + WINDOW_MS - nowMs) / 1000));

  if (record.count < limit) {
    record.count += 1;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - record.count),
      resetSeconds
    };
  }

  return {
    allowed: false,
    limit,
    remaining: 0,
    resetSeconds
  };
}

/**
 * Reads the current window state without incrementing the counter.
 */
export function peekRateLimit(
  key: string,
  nowMs: number = Date.now(),
  customLimit?: number
): RateLimitResult {
  const limit = customLimit ?? config.v1RateLimitPerMinute;
  const record = rateLimitStore.get(key);

  if (!record || nowMs - record.windowStartMs >= WINDOW_MS) {
    return {
      allowed: true,
      limit,
      remaining: limit,
      resetSeconds: 60
    };
  }

  const resetSeconds = Math.max(1, Math.ceil((record.windowStartMs + WINDOW_MS - nowMs) / 1000));
  return {
    allowed: record.count <= limit,
    limit,
    remaining: Math.max(0, limit - record.count),
    resetSeconds
  };
}

/**
 * Clears the in-memory rate limit store (used for test isolation).
 */
export function resetRateLimits(): void {
  rateLimitStore.clear();
}
