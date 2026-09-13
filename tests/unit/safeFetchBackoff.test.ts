import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFetchJson, parseRetryAfterHeader } from '../../src/server/sources/base.js';

describe('parseRetryAfterHeader parsing & rate limit normalization', () => {
  it('parses standard integer seconds', () => {
    expect(parseRetryAfterHeader('30')).toBe(30);
    expect(parseRetryAfterHeader('120')).toBe(120);
    expect(parseRetryAfterHeader('0')).toBe(0);
  });

  it('parses Unix epoch timestamp (e.g. from X-RateLimit-Reset) into remaining seconds', () => {
    const futureEpochSec = Math.floor(Date.now() / 1000) + 42;
    const result = parseRetryAfterHeader(String(futureEpochSec));
    expect(result).toBeGreaterThanOrEqual(41);
    expect(result).toBeLessThanOrEqual(43);
  });

  it('parses HTTP date string into remaining seconds', () => {
    const futureDate = new Date(Date.now() + 25000).toUTCString();
    const result = parseRetryAfterHeader(futureDate);
    expect(result).toBeGreaterThanOrEqual(24);
    expect(result).toBeLessThanOrEqual(26);
  });

  it('returns undefined for null, empty or invalid strings', () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
    expect(parseRetryAfterHeader(undefined)).toBeUndefined();
    expect(parseRetryAfterHeader('')).toBeUndefined();
    expect(parseRetryAfterHeader('not-a-number')).toBeUndefined();
  });
});

describe('Task 21: safeFetchJson backoff & sleep hygiene', () => {
  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
    vi.useRealTimers();
  });

  it('sleeps baseDelay (500 + jitter) on attempt 1 and (1500 + jitter) on attempt 2 for transient !response.ok (e.g. 503), and does NOT sleep after attempt 3', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      return Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers()
      });
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = safeFetchJson('https://api.example.com/transient');

    // Attach catch handler to avoid unhandled rejection warning while fake timers run
    let caughtError: any = null;
    promise.catch(err => {
      caughtError = err;
    });

    // Advance through attempt 1 backoff
    await vi.advanceTimersToNextTimerAsync();
    // Advance through attempt 2 backoff
    await vi.advanceTimersToNextTimerAsync();
    // Attempt 3 fails and throws
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/HTTP 503 Service Unavailable/);
    expect(attempts).toBe(3);

    // Collect backoff timer delays (ignoring the 10000ms abort controller timers)
    const backoffDelays = setTimeoutSpy.mock.calls
      .map(c => c[1])
      .filter((d): d is number => typeof d === 'number' && d !== 10000);

    expect(backoffDelays).toHaveLength(2);
    // Attempt 1 backoff: 500 + jitter [0..199]
    expect(backoffDelays[0]).toBeGreaterThanOrEqual(500);
    expect(backoffDelays[0]).toBeLessThan(700);
    // Attempt 2 backoff: 1500 + jitter [0..199]
    expect(backoffDelays[1]).toBeGreaterThanOrEqual(1500);
    expect(backoffDelays[1]).toBeLessThan(1700);
  });

  it('does NOT sleep or retry on non-transient status (e.g. 404)', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers()
      });
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = safeFetchJson('https://api.example.com/notfound');
    await expect(promise).rejects.toThrow(/HTTP 404 Not Found/);
    expect(attempts).toBe(1);

    const backoffDelays = setTimeoutSpy.mock.calls
      .map(c => c[1])
      .filter((d): d is number => typeof d === 'number' && d !== 10000);

    expect(backoffDelays).toHaveLength(0);
  });

  it('shares the same backoff sleep in catch path for transient network errors', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      attempts++;
      const err: any = new Error('fetch failed');
      return Promise.reject(err);
    });

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = safeFetchJson('https://api.example.com/network-error');
    promise.catch(() => {});

    await vi.advanceTimersToNextTimerAsync();
    await vi.advanceTimersToNextTimerAsync();
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/fetch failed/);
    expect(attempts).toBe(3);

    const backoffDelays = setTimeoutSpy.mock.calls
      .map(c => c[1])
      .filter((d): d is number => typeof d === 'number' && d !== 10000);

    expect(backoffDelays).toHaveLength(2);
    expect(backoffDelays[0]).toBeGreaterThanOrEqual(500);
    expect(backoffDelays[0]).toBeLessThan(700);
    expect(backoffDelays[1]).toBeGreaterThanOrEqual(1500);
    expect(backoffDelays[1]).toBeLessThan(1700);
  });
});
