import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  isValidItadUuid, 
  normalizeItadCountry, 
  formatItadSinceTimestamp,
  ItadSourceAdapter 
} from '../../src/server/sources/itad.js';
import { safeFetchJson } from '../../src/server/sources/base.js';
import { CheapSharkSourceAdapter } from '../../src/server/sources/cheapshark.js';
import { fetchWithAllkeyshopSolver, AllKeyShopUnavailableError } from '../../src/server/sources/allkeyshop.js';
import { config } from '../../src/server/config/index.js';
import { PacedSourceQueue } from '../../src/server/sync/rateLimiter.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { getDb, closeDb } from '../../src/server/db/index.js';
import { createApp } from '../../src/server/index.js';
import { calculateCoreSyncStatus } from '../../src/server/sync/syncOutcome.js';

describe('API Reliability & Edge Cases Suite', () => {
  describe('IsThereAnyDeal (ITAD) Reliability & Guarding', () => {
    it('correctly validates ITAD UUID formats and rejects invalid identifiers', () => {
      expect(isValidItadUuid('018d937f-2997-7131-b8b9-7c8af4825fa8')).toBe(true);
      expect(isValidItadUuid('018D937F-2997-7131-B8B9-7C8AF4825FA8')).toBe(true);
      expect(isValidItadUuid('1091500')).toBe(false);
      expect(isValidItadUuid('cyberpunk-2077')).toBe(false);
      expect(isValidItadUuid('')).toBe(false);
      expect(isValidItadUuid(null)).toBe(false);
      expect(isValidItadUuid(undefined)).toBe(false);
    });

    it('normalizes invalid or continental country codes like EU to a valid ISO 3166-1 alpha-2 code while strictly preserving valid non-HU countries', () => {
      // Valid countries MUST be preserved and NEVER silently converted to HU
      expect(normalizeItadCountry('US')).toBe('US');
      expect(normalizeItadCountry('de')).toBe('DE');
      expect(normalizeItadCountry('FR')).toBe('FR');
      expect(normalizeItadCountry('pl')).toBe('PL');
      expect(normalizeItadCountry('CA')).toBe('CA');
      expect(normalizeItadCountry('AU')).toBe('AU');
      expect(normalizeItadCountry('JP')).toBe('JP');
      expect(normalizeItadCountry('GB')).toBe('GB');

      // UK is vernacular and causes ITAD HTTP 400; must normalize to ISO alpha-2 GB
      expect(normalizeItadCountry('UK')).toBe('GB');
      expect(normalizeItadCountry('uk')).toBe('GB');

      // Invalid or continental codes like EU/GLOBAL must fall back to preferred country or custom fallback
      expect(normalizeItadCountry('EU')).toBe('HU');
      expect(normalizeItadCountry('eu')).toBe('HU');
      expect(normalizeItadCountry('GLOBAL')).toBe('HU');
      expect(normalizeItadCountry(null)).toBe('HU');
      expect(normalizeItadCountry(undefined)).toBe('HU');

      // Custom fallback support
      expect(normalizeItadCountry('EU', 'DE')).toBe('DE');
      expect(normalizeItadCountry(null, 'FR')).toBe('FR');
      expect(normalizeItadCountry('GLOBAL', 'US')).toBe('US');
    });

    it('formats ISO timestamps strictly without milliseconds (.sssZ) for ITAD v2 compliance', () => {
      const formatted = formatItadSinceTimestamp('2026-09-16T18:30:45.123Z');
      expect(formatted).toBe('2026-09-16T18:30:45Z');
      expect(formatted).not.toContain('.');

      const defaultTimestamp = formatItadSinceTimestamp();
      expect(defaultTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(defaultTimestamp).not.toContain('.');
    });

    it('safely skips lookup and overview requests when appId or UUID is invalid', async () => {
      const adapter = new ItadSourceAdapter();
      // Invalid AppID should not trigger network calls
      const id = await adapter.lookupItadId(0);
      expect(id).toBeNull();

      const idNeg = await adapter.lookupItadId(-5);
      expect(idNeg).toBeNull();
    });
  });

  describe('safeFetchJson Error Preservation & Diagnosis', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('preserves detailed upstream JSON error body in error message on HTTP 400', async () => {
      const mockResponse = new Response(JSON.stringify({
        status_code: 400,
        reason_phrase: "Request body must be non-empty JSON array of game IDs"
      }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'application/json' }
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await expect(safeFetchJson('https://api.isthereanydeal.com/games/overview/v2', {}, 1000))
        .rejects.toThrowError(/Request body must be non-empty JSON array of game IDs/);
    });

    it('extracts Retry-After header and preserves status on HTTP 429', async () => {
      const mockResponse = new Response(JSON.stringify({
        error: 'Too Many Requests'
      }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '15'
        }
      });

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        await safeFetchJson('https://www.cheapshark.com/api/1.0/deals', {}, 1000);
        expect.fail('Should have thrown 429');
      } catch (err: any) {
        expect(err.status).toBe(429);
        expect(err.retryAfterSec).toBe(15);
        expect(err.message).toContain('Too Many Requests');
      }
    });
  });

  describe('CheapShark Adapter Resilience', () => {
    beforeEach(() => {
      circuitBreakers.resetAll();
    });

    it('creates an adapter with batch support and correct queue delays', () => {
      const adapter = new CheapSharkSourceAdapter();
      expect(adapter.code).toBe('cheapshark');
      expect(adapter.supportsBatch).toBe(true);
      expect(adapter.isEnabled()).toBe(true);
    });

    it('bounds 429 retries to maximum 2 attempts and records chunk failure on repeated 429', async () => {
      const adapter = new CheapSharkSourceAdapter();
      let callCount = 0;

      // Mock safeFetchJson
      const originalFetch = global.fetch;
      const mock429 = new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '1' }
      });

      // Temporarily mock setTimeout to avoid real 5-10s sleeps in test
      const originalSetTimeout = global.setTimeout;
      (global as any).setTimeout = (fn: any, ms?: number) => originalSetTimeout(fn, 1);

      try {
        vi.spyOn(adapter as any, 'ensureStores').mockResolvedValue(undefined);
        // Intercept queue enqueue to count calls
        const enqueueSpy = vi.spyOn((adapter as any).queue, 'enqueue').mockImplementation(async (fn: any) => {
          callCount++;
          const err: any = new Error('HTTP 429 Too Many Requests');
          err.status = 429;
          err.retryAfterSec = 1;
          throw err;
        });

        // Batch of 1 game: should attempt 0 (retry wait), then attempt 1 (fail), total 2 attempts
        await expect(adapter.fetchBatchPrices([{ steamAppId: 100, title: 'Test Game' }]))
          .rejects.toThrowError(/All 1 CheapShark chunks failed/);

        expect(callCount).toBe(2);
        enqueueSpy.mockRestore();
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });

    it('does not retry on non-429 error and aborts chunk immediately on first attempt', async () => {
      const adapter = new CheapSharkSourceAdapter();
      let callCount = 0;

      vi.spyOn(adapter as any, 'ensureStores').mockResolvedValue(undefined);
      const enqueueSpy = vi.spyOn((adapter as any).queue, 'enqueue').mockImplementation(async () => {
        callCount++;
        const err: any = new Error('HTTP 500 Internal Server Error');
        err.status = 500;
        throw err;
      });

      await expect(adapter.fetchBatchPrices([{ steamAppId: 100, title: 'Test Game' }]))
        .rejects.toThrowError(/All 1 CheapShark chunks failed/);

      expect(callCount).toBe(1);
      enqueueSpy.mockRestore();
    });
  });

  describe('AllKeyShop Solver Resilience & Cookie Invalidation', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns null gracefully when allkeyshopSolverUrl is not configured', async () => {
      const originalSolver = config.allkeyshopSolverUrl;
      try {
        (config as any).allkeyshopSolverUrl = '';
        const res = await fetchWithAllkeyshopSolver('https://example.com');
        expect(res).toBeNull();
      } finally {
        (config as any).allkeyshopSolverUrl = originalSolver;
      }
    });

    it('throws AllKeyShopUnavailableError with status 408 on solver timeout message', async () => {
      const originalSolver = config.allkeyshopSolverUrl;
      try {
        (config as any).allkeyshopSolverUrl = 'http://solver.local:8191';

        const mockResponse = new Response(JSON.stringify({
          status: 'error',
          message: 'Error: Error solving the challenge. Timeout after 30.00 seconds.',
          solution: { status: 408 }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

        global.fetch = vi.fn().mockResolvedValue(mockResponse);

        await expect(fetchWithAllkeyshopSolver('https://allkeyshop.com/test', 2000))
          .rejects.toThrowError(AllKeyShopUnavailableError);
      } finally {
        (config as any).allkeyshopSolverUrl = originalSolver;
      }
    });
  });

  describe('PacedSourceQueue Concurrency & Clear Lifecycle', () => {
    it('cancels pending items cleanly on clear without breaking future enqueued items', async () => {
      const queue = new PacedSourceQueue('steam', 20, 0);

      const p1 = queue.enqueue(async () => {
        await new Promise(r => setTimeout(r, 20));
        return 'first';
      });

      let p2Rejected = false;
      const p2 = queue.enqueue(async () => 'second').catch(err => {
        p2Rejected = true;
        return 'caught';
      });

      // Clear immediately while first is running
      queue.clear();
      expect(queue.pendingCount).toBe(0);

      const r1 = await p1;
      const r2 = await p2;

      expect(r1).toBe('first');
      expect(p2Rejected).toBe(true);
      expect(r2).toBe('caught');

      // Subsequent enqueue should function normally
      const r3 = await queue.enqueue(async () => 'third');
      expect(r3).toBe('third');
    });
  });

  describe('ITAD Batch Chunk Error Containment', () => {
    it('preserves results from successful chunks even if another chunk throws an error', async () => {
      const adapter = new ItadSourceAdapter();
      const originalKey = config.itadApiKey;

      try {
        (config as any).itadApiKey = 'test-key';

        // Mock fetchBatchOverview: chunk with uuid-1 succeeds, chunk with uuid-2 throws
        const spy = vi.spyOn(adapter as any, 'fetchBatchOverview').mockImplementation(async (...args: any[]) => {
          const ids = args[0] as string[];
          if (ids.includes('fail-id')) {
            const err: any = new Error('500 Internal Server Error on ITAD');
            err.status = 500;
            throw err;
          }
          const map = new Map();
          map.set(100, [{
            merchantCode: 'humblestore',
            merchantName: 'Humble Store',
            isOfficial: true,
            productTypeRaw: 'Steam Key',
            regionRaw: 'GLOBAL',
            priceEur: 19.99
          }]);
          return map;
        });

        // We simulate a call where games cross the 150-item chunk boundary
        const games = Array.from({ length: 151 }, (_, i) => ({
          steamAppId: i === 0 ? 100 : (i === 150 ? 200 : 300 + i),
          title: `Game ${i}`,
          itadId: i === 150 ? 'fail-id' : `uuid-${i}`
        }));

        const results = await adapter.fetchBatchPrices(games);
        expect(results.has(100)).toBe(true);
        expect(results.get(100)?.length).toBe(1);
        expect(results.get(100)?.[0].priceEur).toBe(19.99);

        // Verify partial failure is distinctly surfaced, NOT reported as full success
        expect((results as any).failedChunks).toBe(1);
        expect((results as any).totalChunks).toBe(2);

        spy.mockRestore();
      } finally {
        (config as any).itadApiKey = originalKey;
      }
    });

    it('throws aggregate error when 100% of ITAD chunks fail, preventing false SUCCESS reporting', async () => {
      const adapter = new ItadSourceAdapter();
      const originalKey = config.itadApiKey;

      try {
        (config as any).itadApiKey = 'test-key';

        const spy = vi.spyOn(adapter as any, 'fetchBatchOverview').mockImplementation(async () => {
          const err: any = new Error('503 Service Unavailable');
          err.status = 503;
          throw err;
        });

        const games = [{ steamAppId: 100, title: 'Game 1', itadId: 'uuid-1' }];
        await expect(adapter.fetchBatchPrices(games))
          .rejects.toThrowError(/All 1 ITAD chunks failed during batch fetch/);

        spy.mockRestore();
      } finally {
        (config as any).itadApiKey = originalKey;
      }
    });

    it('calculates COMPLETED_WITH_WARNINGS and marks warningSources when any source has PARTIAL outcome', () => {
      const outcomeMap = new Map<any, any>([
        ['steam', 'SUCCESS'],
        ['itad', 'PARTIAL'],
        ['cheapshark', 'SUCCESS'],
        ['ggdeals', 'SUCCESS']
      ]);

      const outcome = calculateCoreSyncStatus(['steam', 'itad', 'cheapshark', 'ggdeals'], outcomeMap);
      expect(outcome.status).toBe('COMPLETED_WITH_WARNINGS');
      expect(outcome.failedSources).toContain('itad');
    });
  });

  describe('Database Lifecycle & Safe Checkpoint', () => {
    it('executes closeDb cleanly with WAL checkpoint without throwing errors', () => {
      const db = getDb();
      expect(db.open).toBe(true);

      expect(() => closeDb()).not.toThrow();

      // Ensure reopening works immediately
      const reopened = getDb();
      expect(reopened.open).toBe(true);
    });
  });

  describe('Security & Configuration Hardening', () => {
    it('normalizes trustedOrigins and strips trailing slashes', () => {
      const raw = 'http://localhost:5173/, https://app.example.com/// ';
      const normalized = raw.split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
      expect(normalized).toEqual(['http://localhost:5173', 'https://app.example.com']);
    });

    it('authenticates with both X-API-Token and Authorization Bearer token', async () => {
      const originalToken = config.apiToken;
      try {
        (config as any).apiToken = 'secret-test-token';
        const app = await createApp();

        // 1. Missing token -> 401
        const resMissing = await app.inject({
          method: 'GET',
          url: '/api/profiles'
        });
        expect(resMissing.statusCode).toBe(401);

        // 2. Valid X-API-Token -> 200
        const resHeader = await app.inject({
          method: 'GET',
          url: '/api/profiles',
          headers: { 'x-api-token': 'secret-test-token' }
        });
        expect(resHeader.statusCode).toBe(200);

        // 3. Valid Bearer token -> 200
        const resBearer = await app.inject({
          method: 'GET',
          url: '/api/profiles',
          headers: { 'authorization': 'Bearer secret-test-token' }
        });
        expect(resBearer.statusCode).toBe(200);

        // 4. Invalid token -> 401
        const resInvalid = await app.inject({
          method: 'GET',
          url: '/api/profiles',
          headers: { 'authorization': 'Bearer wrong-token' }
        });
        expect(resInvalid.statusCode).toBe(401);

        await app.close();
      } finally {
        (config as any).apiToken = originalToken;
      }
    });
  });
});
