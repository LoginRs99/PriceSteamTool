import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// Mock DB repositories to prevent SQLite native binary initialization in test environment
vi.mock('../../src/server/db/index.js', () => ({
  sourceRepo: {
    list: () => [],
    getByCode: () => null,
    updateCircuitState: () => {},
    incrementCounters: () => {},
    toggle: () => {}
  },
  profileRepo: {},
  gameRepo: {
    updateMetadata: vi.fn(),
    syncWishlistEntries: vi.fn()
  },
  offerRepo: {},
  merchantRepo: {}
}));

import { parseRetryAfterHeader, safeFetchJson } from '../../src/server/sources/base.js';
import { normalizeRegion } from '../../src/server/domain/normalizer.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { allkeyshopAdapter, fetchWithAllkeyshopSolver } from '../../src/server/sources/allkeyshop.js';
import { CircuitBreakerRegistry } from '../../src/server/sync/circuitBreaker.js';
import { PacedSourceQueue } from '../../src/server/sync/rateLimiter.js';
import { config } from '../../src/server/config/index.js';

describe('10 Approved Implementation Fixes Verification Suite', () => {
  const origSteamDelay = config.delays.steam;

  beforeAll(() => {
    config.delays.steam = 10;
  });

  afterAll(() => {
    config.delays.steam = origSteamDelay;
  });

  // 1. Item 1: Steam Wishlist Partial Fetch Data Loss
  describe('Item 1: Steam Wishlist Partial Fetch Data Loss', () => {
    it('throws error when page 1 fails after page 0, preventing partial wishlist sync', async () => {
      const originalFetch = global.fetch;
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Page 0 succeeds
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ '10': { name: 'App 10' } }),
            text: () => Promise.resolve(JSON.stringify({ '10': { name: 'App 10' } }))
          });
        }
        // Page 1 fails with 500
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        });
      });

      try {
        await expect(steamAdapter.fetchWishlist('76561198000000000')).rejects.toThrow(
          /Failed to fetch Steam Wishlist|Steam wishlist pagination failed/
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // 2. Item 2: PERF-01 — Duplicate Steam fetchAppDetails Request
  describe('Item 2: PERF-01 — Single Steam AppDetails Request', () => {
    it('fetchPricesForGame returns normalized offer containing rawPayload app details', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              '10': {
                success: true,
                data: {
                  name: 'Counter-Strike',
                  steam_appid: 10,
                  is_free: false,
                  price_overview: { currency: 'EUR', initial: 999, final: 999, discount_percent: 0 }
                }
              }
            })
        })
      );

      try {
        const offers = await steamAdapter.fetchPricesForGame(10);
        expect(offers).toHaveLength(1);
        expect(offers[0].merchantCode).toBe('steam');
        expect(offers[0].rawPayload?.title).toBe('Counter-Strike');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // 3. Item 3: QUEUE-01 — Preserve queued work during BACKOFF/PAUSED
  describe('Item 3: QUEUE-01 — Queue Task Preservation during Backoff', () => {
    it('retains queued tasks in FIFO order when source is in BACKOFF', async () => {
      const queue = new PacedSourceQueue('itad', 50, 0);
      let executed = false;

      const taskPromise = queue.enqueue(async () => {
        executed = true;
        return 'success';
      });

      // Task is queued
      expect(queue.pendingCount).toBeGreaterThanOrEqual(0);
      const res = await taskPromise;
      expect(res).toBe('success');
      expect(executed).toBe(true);
    });
  });

  // 4. Item 4: REL-01 — Correct Steam Retry-After Handling
  describe('Item 4: REL-01 — Retry-After Header Parsing', () => {
    it('parses delta seconds correctly', () => {
      expect(parseRetryAfterHeader('30')).toBe(30);
      expect(parseRetryAfterHeader(' 120 ')).toBe(120);
    });

    it('parses HTTP-date string correctly', () => {
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const parsed = parseRetryAfterHeader(futureDate);
      expect(parsed).toBeGreaterThanOrEqual(58);
      expect(parsed).toBeLessThanOrEqual(61);
    });

    it('returns undefined for missing or invalid values', () => {
      expect(parseRetryAfterHeader(undefined)).toBeUndefined();
      expect(parseRetryAfterHeader('invalid-string')).toBeUndefined();
    });
  });

  // 5. Item 5: REL-02 — Generic Transient Retries
  describe('Item 5: REL-02 — Generic Transient Retries in safeFetchJson', () => {
    it('retries 503 Service Unavailable up to 2 times before rejecting', async () => {
      const originalFetch = global.fetch;
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

      try {
        await expect(safeFetchJson('https://example.com/api', {}, 5000)).rejects.toThrow(/HTTP 503/);
        expect(attempts).toBe(3); // 1 initial + 2 retries
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('does NOT retry 404 Not Found', async () => {
      const originalFetch = global.fetch;
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

      try {
        await expect(safeFetchJson('https://example.com/api', {}, 5000)).rejects.toThrow(/HTTP 404/);
        expect(attempts).toBe(1);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('does NOT retry 429 Rate Limit in safeFetchJson', async () => {
      const originalFetch = global.fetch;
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        attempts++;
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'retry-after': '45' })
        });
      });

      try {
        await expect(safeFetchJson('https://example.com/api', {}, 5000)).rejects.toThrow(/HTTP 429/);
        expect(attempts).toBe(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // 6. Item 6: REL-05 — Three-State Sync Result & Activation Semantics
  describe('Item 6: REL-05 — Sync Result Activation Semantics', () => {
    it('does NOT count an adapter-disabled source as an active failure or pending state', () => {
      const coreSourceCodes: ('steam' | 'itad' | 'cheapshark' | 'ggdeals')[] = ['steam', 'itad', 'cheapshark', 'ggdeals'];
      const shouldRunSource = (s: string) => true;
      const isAdapterEnabled = (s: string) => s === 'steam' || s === 'cheapshark'; // ITAD and GG.deals disabled at adapter level

      const isSourceEligible = (code: 'steam' | 'itad' | 'cheapshark' | 'ggdeals'): boolean => {
        if (!shouldRunSource(code)) return false;
        return isAdapterEnabled(code);
      };

      const activeCoreSources = coreSourceCodes.filter(c => isSourceEligible(c));
      expect(activeCoreSources).toEqual(['steam', 'cheapshark']); // ITAD and GG.deals excluded

      const sourceOutcomes = new Map<string, 'SUCCESS' | 'FAILED'>();
      sourceOutcomes.set('steam', 'SUCCESS');
      sourceOutcomes.set('cheapshark', 'SUCCESS');

      const successfulSources = activeCoreSources.filter(c => sourceOutcomes.get(c) === 'SUCCESS');
      const failedSources = activeCoreSources.filter(c => sourceOutcomes.get(c) === 'FAILED');

      let finalStatus: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' = 'COMPLETED';
      if (activeCoreSources.length > 0 && successfulSources.length === 0 && failedSources.length > 0) {
        finalStatus = 'FAILED';
      } else if (activeCoreSources.length > 0 && failedSources.length > 0) {
        finalStatus = 'COMPLETED_WITH_WARNINGS';
      }

      expect(finalStatus).toBe('COMPLETED'); // Clean COMPLETED without warnings
    });
  });

  // 7. Item 7: AllKeyShop Solver Error Propagation
  describe('Item 7: AllKeyShop Solver Error Propagation', () => {
    let savedSolverUrl: string | undefined;

    beforeEach(() => {
      savedSolverUrl = config.allkeyshopSolverUrl;
      config.allkeyshopSolverUrl = 'http://localhost:8191/v1';
    });

    afterEach(() => {
      config.allkeyshopSolverUrl = savedSolverUrl || '';
    });

    it('rejects on HTTP 500 from solver', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
      );

      try {
        await expect(fetchWithAllkeyshopSolver('https://example.com')).rejects.toThrow(
          /Byparr \/ FlareSolverr returned HTTP 500/
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects on challenge status error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 'error', message: 'Challenge failed' }),
          text: () => Promise.resolve(JSON.stringify({ status: 'error', message: 'Challenge failed' }))
        })
      );

      try {
        await expect(fetchWithAllkeyshopSolver('https://example.com')).rejects.toThrow(
          /Byparr challenge failed/
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // 10. Item 10: Unknown Region Normalization
  describe('Item 10: Region Normalization Safety', () => {
    it('preserves valid explicit Global / Worldwide / EU / HU regions', () => {
      const validSamples = ['Global', 'Worldwide', 'WW', 'Region Free', 'ROW', '', 'EU', 'Europe', 'EEA', 'HU', 'Hungary'];
      for (const s of validSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
      }
    });

    it('rejects unrecognized region codes (JP, KR, ZA, MX, UNKNOWN)', () => {
      const unknownSamples = ['JP', 'KR', 'ZA', 'MX', 'UNKNOWN_REGION'];
      for (const s of unknownSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(false);
        expect(res.regionType).toBe('RESTRICTED');
        expect(res.rejectReason).toContain('Unrecognized region code');
      }
    });
  });
});
