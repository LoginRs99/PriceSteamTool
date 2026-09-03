import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  fetchWithAllkeyshopSolver, 
  AllKeyShopUnavailableError,
  validateAllKeyShopPriceResponse,
  validateAllKeyShopCatalog
} from '../../src/server/sources/allkeyshop.js';
import { config } from '../../src/server/config/index.js';

describe('AllKeyShop API Wrapper & Solver Resilience Suite', () => {
  const originalSolverUrl = config.allkeyshopSolverUrl;

  beforeEach(() => {
    config.allkeyshopSolverUrl = 'http://localhost:8191/v1';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    config.allkeyshopSolverUrl = originalSolverUrl;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. HTTP 429 (Rate Limit) & Retry-After Extraction Tests
  // =========================================================================
  it('extracts Retry-After header when Byparr/FlareSolverr returns HTTP 429 directly', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('retry-after', '75');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: mockHeaders,
      json: async () => ({})
    });

    try {
      await fetchWithAllkeyshopSolver('https://example.com/test');
      expect.fail('Should have thrown AllKeyShopUnavailableError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AllKeyShopUnavailableError);
      expect(err.status).toBe(429);
      expect(err.retryAfterSec).toBe(75);
      expect(err.message).toContain('HTTP 429');
    }
  });

  it('extracts Retry-After header when Byparr returns solution.status 429 with headers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'error',
        message: 'Rate limited by Cloudflare challenge',
        solution: {
          status: 429,
          headers: {
            'retry-after': '150'
          }
        }
      })
    });

    try {
      await fetchWithAllkeyshopSolver('https://example.com/test');
      expect.fail('Should have thrown AllKeyShopUnavailableError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AllKeyShopUnavailableError);
      expect(err.status).toBe(429);
      expect(err.retryAfterSec).toBe(150);
    }
  });

  // =========================================================================
  // 2. Network Timeouts & Solver Failure Fail-Safe Handling
  // =========================================================================
  it('handles network connection error and wraps it as 502 AllKeyShopUnavailableError', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    try {
      await fetchWithAllkeyshopSolver('https://example.com/test');
      expect.fail('Should have thrown AllKeyShopUnavailableError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AllKeyShopUnavailableError);
      expect(err.status).toBe(502);
      expect(err.message).toContain('ECONNREFUSED');
    }
  });

  it('parses embedded JSON from string solution response', async () => {
    const payload = { status: 'success', games: [{ id: 101, name: 'Hades' }] };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        status: 'ok',
        solution: {
          status: 200,
          response: `<html><body><pre>${JSON.stringify(payload)}</pre></body></html>`
        }
      })
    });

    const result = await fetchWithAllkeyshopSolver<typeof payload>('https://example.com/test');
    expect(result).toEqual(payload);
  });

  // =========================================================================
  // 3. Runtime Response Validation Tests
  // =========================================================================
  describe('validateAllKeyShopPriceResponse', () => {
    it('validates and extracts clean history and dictionaries from valid API response', () => {
      const validRaw = {
        history: [
          {
            merchant_id: 10,
            edition: 1,
            region: 2,
            min_discount_price: 15.50,
            last_price: 18.00,
            best_discount_code: 'SAVE10',
            start: '2026-08-01',
            end: '2026-08-15'
          }
        ],
        merchants: { '10': { name: 'K4G' } },
        editions: { '1': { name: 'Standard' } },
        regions: { '2': { name: 'Global' } },
        officialMerchants: [1, 2]
      };

      const validated = validateAllKeyShopPriceResponse(validRaw);
      expect(validated).not.toBeNull();
      expect(validated?.history.length).toBe(1);
      expect(validated?.history[0].merchant_id).toBe(10);
      expect(validated?.merchants?.['10'].name).toBe('K4G');
      expect(validated?.officialMerchants).toEqual([1, 2]);
    });

    it('rejects corrupt payload when history is missing or not an array', () => {
      expect(validateAllKeyShopPriceResponse(null)).toBeNull();
      expect(validateAllKeyShopPriceResponse({})).toBeNull();
      expect(validateAllKeyShopPriceResponse({ history: 'not-an-array' })).toBeNull();
      expect(validateAllKeyShopPriceResponse({ status: 'error' })).toBeNull();
    });
  });

  describe('validateAllKeyShopCatalog', () => {
    it('validates catalog and filters out non-conforming items', () => {
      const rawCatalog = {
        status: 'success',
        games: [
          { id: 1, name: 'Portal 2', slug: 'portal-2' },
          { id: 'invalid', name: 'Corrupt Game' }, // invalid id type
          { id: 2, name: 'Half-Life 2' }
        ]
      };

      const validated = validateAllKeyShopCatalog(rawCatalog);
      expect(validated).not.toBeNull();
      expect(validated?.games.length).toBe(2);
      expect(validated?.games[0].name).toBe('Portal 2');
      expect(validated?.games[1].name).toBe('Half-Life 2');
    });

    it('rejects catalog when status is not success', () => {
      expect(validateAllKeyShopCatalog({ status: 'error', games: [] })).toBeNull();
      expect(validateAllKeyShopCatalog(null)).toBeNull();
    });
  });
});
