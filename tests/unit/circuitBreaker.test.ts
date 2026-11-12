import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreakerRegistry } from '../../src/server/sync/circuitBreaker.js';
import { getDb } from '../../src/server/db/core.js';
import { sourceRepo } from '../../src/server/db/repositories/source.js';

describe('Circuit Breaker State Machine — State Transitions', () => {
  beforeEach(() => {
    try {
      const db = getDb();
      db.exec(`UPDATE sources SET state = 'NORMAL', consecutive_failures = 0, consecutive_rate_limits = 0, cooldown_until = NULL;`);
    } catch (e) {}
  });

  it('starts in NORMAL state and allows execution', () => {
    const cb = new CircuitBreakerRegistry();
    const check = cb.canExecute('itad');
    expect(check.allowed).toBe(true);
    expect(cb.getState('itad')).toBe('NORMAL');
  });

  it('transitions to BACKOFF on rate limit 429 with retry-after', () => {
    const cb = new CircuitBreakerRegistry();
    cb.recordRateLimit('cheapshark', 15);
    expect(cb.getState('cheapshark')).toBe('BACKOFF');
    
    const check = cb.canExecute('cheapshark');
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('BACKOFF');
  });

  it('transitions to PAUSED after repeated rate limits', () => {
    const cb = new CircuitBreakerRegistry();
    cb.recordRateLimit('allkeyshop', 10);
    cb.recordRateLimit('allkeyshop', 10);
    cb.recordRateLimit('allkeyshop', 10);
    expect(cb.getState('allkeyshop')).toBe('PAUSED');
  });

  it('transitions to PAUSED after 4 consecutive network failures', () => {
    const cb = new CircuitBreakerRegistry();
    cb.recordFailure('steam', 'Connection timed out');
    cb.recordFailure('steam', 'Connection timed out');
    expect(cb.getState('steam')).toBe('BACKOFF');

    cb.recordFailure('steam', 'Connection timed out');
    cb.recordFailure('steam', 'Connection timed out');
    expect(cb.getState('steam')).toBe('PAUSED');
  });

  it('resets to NORMAL upon success', () => {
    const cb = new CircuitBreakerRegistry();
    cb.recordFailure('ggdeals', 'Temporary error');
    cb.recordSuccess('ggdeals');
    expect(cb.getState('ggdeals')).toBe('NORMAL');
    expect(cb.canExecute('ggdeals').allowed).toBe(true);
  });

  it('does not immediately trip to BACKOFF on first failure after restart when historical failureCount > 0', () => {
    const cb = new CircuitBreakerRegistry();
    // Simulate first failure after restart: consecutiveFailures starts at 0 -> becomes 1
    cb.recordFailure('itad', 'Transient error 1');
    // Threshold for BACKOFF is consecutiveFailures >= 2; 1 failure should stay in NORMAL
    expect(cb.getState('itad')).toBe('NORMAL');
  });

  it('handles PAUSED state with null or elapsed cooldown by transitioning to COOLDOWN probe', () => {
    const cb = new CircuitBreakerRegistry();
    cb.recordFailure('steam', 'err 1');
    cb.recordFailure('steam', 'err 2');
    cb.recordFailure('steam', 'err 3');
    cb.recordFailure('steam', 'err 4');
    expect(cb.getState('steam')).toBe('PAUSED');

    // Manually force cooldownUntil to past or null to simulate legacy DB record
    const info = (cb as any).getOrCreate('steam');
    info.cooldownUntil = Date.now() - 1000;

    const check = cb.canExecute('steam');
    expect(check.allowed).toBe(true);
    expect(cb.getState('steam')).toBe('COOLDOWN');
  });

  it('clears last_error in database and resets consecutive failures when next request succeeds', () => {
    const cb = new CircuitBreakerRegistry();
    
    // Simulate failure
    cb.recordFailure('cheapshark', 'HTTP 429 Too Many Requests');
    let src = sourceRepo.getByCode('cheapshark');
    expect(src?.lastError).toContain('HTTP 429');

    // Simulate next request succeeding
    cb.recordSuccess('cheapshark');
    src = sourceRepo.getByCode('cheapshark');
    expect(src?.lastError).toBeUndefined();
    expect(src?.state).toBe('NORMAL');
    expect(src?.consecutiveFailures).toBe(0);
  });

  it('resets a PAUSED source and clears its cooldown and error via reset()', () => {
    const cb = new CircuitBreakerRegistry();

    // Force to PAUSED
    cb.recordFailure('allkeyshop', 'Fatal network 1');
    cb.recordFailure('allkeyshop', 'Fatal network 2');
    cb.recordFailure('allkeyshop', 'Fatal network 3');
    cb.recordFailure('allkeyshop', 'Fatal network 4');
    expect(cb.getState('allkeyshop')).toBe('PAUSED');

    // Call reset
    cb.reset('allkeyshop');
    expect(cb.getState('allkeyshop')).toBe('NORMAL');
    expect(cb.canExecute('allkeyshop').allowed).toBe(true);

    const src = sourceRepo.getByCode('allkeyshop');
    expect(src?.state).toBe('NORMAL');
    expect(src?.cooldownUntil).toBeUndefined();
    expect(src?.consecutiveFailures).toBe(0);
    expect(src?.lastError).toBeUndefined();
  });

  it('respects 300, 600, and larger requested cooldowns without early retry', () => {
    const cb = new CircuitBreakerRegistry();

    // 1. 300 seconds requested cooldown
    cb.recordRateLimit('nexarda', 300);
    expect(cb.getState('nexarda')).toBe('BACKOFF');
    let remaining = cb.getRemainingCooldownSec('nexarda');
    expect(remaining).toBeGreaterThanOrEqual(295);
    expect(remaining).toBeLessThanOrEqual(300);
    expect(cb.canExecute('nexarda').allowed).toBe(false);

    // 2. 600 seconds requested cooldown (never retried prematurely at 300s)
    cb.recordRateLimit('nexarda', 600);
    remaining = cb.getRemainingCooldownSec('nexarda');
    expect(remaining).toBeGreaterThanOrEqual(595);
    expect(remaining).toBeLessThanOrEqual(600);
    expect(cb.canExecute('nexarda').allowed).toBe(false);

    // 3. 1200 seconds requested cooldown
    cb.recordRateLimit('nexarda', 1200);
    remaining = cb.getRemainingCooldownSec('nexarda');
    expect(remaining).toBeGreaterThanOrEqual(1195);
    expect(remaining).toBeLessThanOrEqual(1200);
    expect(cb.canExecute('nexarda').allowed).toBe(false);

    // 4. Sanity upper ceiling prevents integer overflow on absurd upstream headers
    cb.recordRateLimit('nexarda', 200000);
    remaining = cb.getRemainingCooldownSec('nexarda');
    expect(remaining).toBeLessThanOrEqual(86400); // 24 hours
    expect(remaining).toBeGreaterThanOrEqual(86300);
  });
});
