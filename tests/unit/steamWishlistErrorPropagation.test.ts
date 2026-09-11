import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { steamAdapter } from '../../src/server/sources/steam.js';
import * as logger from '../../src/server/utils/logger.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('Steam Wishlist Error Propagation & Retry-After', () => {
  const origSteamDelay = config.delays.steam;
  const origInterval = (steamAdapter as any).queue.minIntervalMs;
  const origJitter = (steamAdapter as any).queue.jitterMs;
  const origFetch = global.fetch;

  beforeEach(() => {
    circuitBreakers.resetAll();
    config.delays.steam = 0;
    (steamAdapter as any).queue.minIntervalMs = 0;
    (steamAdapter as any).queue.jitterMs = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    circuitBreakers.resetAll();
    global.fetch = origFetch;
    config.delays.steam = origSteamDelay;
    (steamAdapter as any).queue.minIntervalMs = origInterval;
    (steamAdapter as any).queue.jitterMs = origJitter;
  });

  it('logs warning and rethrows when pagination fails with 500, without invoking IWishlistService', async () => {
    const logWarnSpy = vi.spyOn(logger, 'logWarn');
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('wishlistdata')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers()
        });
      }
      // IWishlistService should not be called
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ response: { items: [] } })),
        headers: new Headers()
      });
    });
    global.fetch = fetchMock;

    let caughtErr: any = null;
    try {
      await steamAdapter.fetchWishlist('76561198000000000');
    } catch (err: any) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr.status).toBe(500);
    expect(caughtErr.requestCount).toBeGreaterThanOrEqual(1);
    expect(caughtErr.message).toContain('Steam wishlist pagination failed');

    // Verify logWarn was called with page, status, message
    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Steam wishlist pagination failed on page 0'),
      expect.objectContaining({
        page: 0,
        status: 500,
        message: expect.stringContaining('500')
      })
    );

    // Verify IWishlistService fallback was NEVER requested
    const wishlistServiceCalls = fetchMock.mock.calls.filter(args =>
      String(args[0]).includes('IWishlistService')
    );
    expect(wishlistServiceCalls.length).toBe(0);
  });

  it('rethrows with status 429 and retryAfterSec when rate-limited', async () => {
    vi.useFakeTimers();
    const logWarnSpy = vi.spyOn(logger, 'logWarn');
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('wishlistdata')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'retry-after': '45' })
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({})),
        headers: new Headers()
      });
    });
    global.fetch = fetchMock;

    let caughtErr: any = null;
    const fetchPromise = steamAdapter.fetchWishlist('76561198000000000').catch((err: any) => {
      caughtErr = err;
    });

    // Advance timers for the 45s backoffMs
    await vi.advanceTimersByTimeAsync(50000);
    await fetchPromise;
    vi.useRealTimers();

    expect(caughtErr).not.toBeNull();
    expect(caughtErr.status).toBe(429);
    expect(caughtErr.retryAfterSec).toBe(45);

    expect(logWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Steam wishlist pagination failed'),
      expect.objectContaining({
        page: 0,
        status: 429,
        retryAfterSec: 45
      })
    );
  });

  it('invokes IWishlistService fallback ONLY on normal empty-wishlist exit (items.length === 0)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('wishlistdata')) {
        // Normal empty wishlist response from storefront
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
          headers: new Headers()
        });
      }
      if (url.includes('IWishlistService')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            response: {
              items: [
                { appid: 730, priority: 1, date_added: 1600000000 }
              ]
            }
          })),
          headers: new Headers()
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    global.fetch = fetchMock;

    const items = await steamAdapter.fetchWishlist('76561198000000000');
    expect(items.length).toBe(1);
    expect(items[0].steamAppId).toBe(730);

    // Verify IWishlistService fallback WAS called
    const wishlistServiceCalls = fetchMock.mock.calls.filter(args =>
      String(args[0]).includes('IWishlistService')
    );
    expect(wishlistServiceCalls.length).toBe(1);
  });
});
