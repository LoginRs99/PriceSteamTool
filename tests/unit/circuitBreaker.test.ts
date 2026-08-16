import { describe, it, expect } from 'vitest';
import { CircuitBreakerRegistry } from '../../src/server/sync/circuitBreaker.js';

describe('Circuit Breaker State Machine — State Transitions', () => {
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
});
