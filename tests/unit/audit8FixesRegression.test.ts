import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';



import { normalizeRegion } from '../../src/server/domain/normalizer.js';
import { sourceRepo } from '../../src/server/db/repositories/source.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { allkeyshopAdapter, fetchWithAllkeyshopSolver } from '../../src/server/sources/allkeyshop.js';
import { CircuitBreakerRegistry, circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('Audit 8-Fix Verification & Regression Suite', () => {
  const origSteamDelay = config.delays.steam;
  const origInterval = (steamAdapter as any).queue.minIntervalMs;
  const origJitter = (steamAdapter as any).queue.jitterMs;

  beforeEach(() => {
    circuitBreakers.resetAll();
    config.delays.steam = 0;
    (steamAdapter as any).queue.minIntervalMs = 0;
    (steamAdapter as any).queue.jitterMs = 0;
  });

  afterEach(() => {
    config.delays.steam = origSteamDelay;
    (steamAdapter as any).queue.minIntervalMs = origInterval;
    (steamAdapter as any).queue.jitterMs = origJitter;
  });

  describe('Fix 1: Steam Wishlist Partial Fetch Safeguard', () => {
    it('throws an error when wishlist pagination fails on page 1, preventing partial sync', async () => {
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
        // Page 1 fails with HTTP 500
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
    }, 15000);
  });

  describe('Fix 2: AllKeyShop Solver Error Propagation', () => {
    let savedSolverUrl: string | undefined;

    beforeEach(() => {
      savedSolverUrl = config.allkeyshopSolverUrl;
      config.allkeyshopSolverUrl = 'http://localhost:8191/v1';
    });

    afterEach(() => {
      config.allkeyshopSolverUrl = savedSolverUrl || '';
    });

    it('throws an error on HTTP 500 from solver', async () => {
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

    it('throws an error on challenge failure status', async () => {
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

  describe('Fix 5: Region Normalization — Unknown & Restricted Regions', () => {
    it('preserves valid explicit Global regions', () => {
      const globalSamples = ['Global', 'Worldwide', 'WW', 'Region Free', ''];
      for (const s of globalSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
        expect(res.regionType).toBe('GLOBAL');
      }
    });

    it('preserves valid explicit EU/HU regions', () => {
      const euSamples = ['EU', 'Europe', 'EEA', 'HU', 'Hungary'];
      for (const s of euSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
        expect(['EU', 'HU']).toContain(res.regionType);
      }
    });

    it('rejects unrecognized/unknown foreign region strings (JP, KR, ZA, UNKNOWN)', () => {
      const unknownSamples = ['JP', 'KR', 'ZA', 'MX', 'UNKNOWN_REGION'];
      for (const s of unknownSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(false);
        expect(res.regionType).toBe('RESTRICTED');
        expect(res.rejectReason).toContain('Unrecognized region code');
      }
    });
  });

  describe('Fix 8: Circuit Breaker Reset on Startup', () => {
    it('resets consecutiveFailures and consecutiveRateLimits to 0 on startup', () => {
      sourceRepo.updateCircuitState('steam', 'NORMAL');
      const registry = new CircuitBreakerRegistry();
      const state = registry.getState('steam');
      expect(state).toBe('NORMAL');
      const check = registry.canExecute('steam');
      expect(check.allowed).toBe(true);
    });
  });
});
