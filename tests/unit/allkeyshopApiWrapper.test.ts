import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  fetchWithAllkeyshopSolver, 
  AllKeyShopUnavailableError,
  validateAllKeyShopPriceResponse,
  validateAllKeyShopCatalog,
  parseAllKeyShopGamePage,
  parseAllKeyShopPriceHistory
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

  describe('parseAllKeyShopGamePage (Live Comparison Table & Fees)', () => {
    it('parses live gamePageTrans including credit card fees and discounts, filtering out accounts and out-of-stock items', () => {
      const mockHtml = `
        <!doctype html>
        <html>
        <head><title>Test Game</title></head>
        <body>
        <script>
        var gamePageTrans = {
          "merchants": {
            "100": { "name": "K4G", "official": false },
            "101": { "name": "Wyrel", "official": false },
            "102": { "name": "SketchyAccountShop", "official": false }
          },
          "editions": { "1": { "name": "Standard" } },
          "regions": { "2": { "name": "Global" } },
          "prices": [
            {
              "id": 1,
              "merchant": 100,
              "originalPrice": 0.25,
              "price": 0.21,
              "priceCard": 0.63,
              "feesCard": 0.42,
              "voucher_code": "AKS14DEAL",
              "account": false,
              "dispo": 1,
              "activationPlatform": "steam",
              "edition": "1",
              "region": "2"
            },
            {
              "id": 2,
              "merchant": 101,
              "originalPrice": 1.24,
              "price": 1.05,
              "priceCard": 1.09,
              "feesCard": 0.04,
              "voucher_code": "allkeyshop",
              "account": false,
              "dispo": 1,
              "activationPlatform": "steam",
              "edition": "1",
              "region": "2"
            },
            {
              "id": 3,
              "merchant": 102,
              "price": 0.10,
              "account": true,
              "dispo": 1,
              "activationPlatform": "steam"
            },
            {
              "id": 4,
              "merchant": 100,
              "price": 0.15,
              "account": false,
              "dispo": 0,
              "activationPlatform": "steam"
            },
            {
              "id": 5,
              "merchant": 100,
              "price": 0.19,
              "account": false,
              "dispo": 1,
              "activationPlatform": "xbox"
            }
          ]
        };
        </script>
        </body>
        </html>
      `;

      const offers = parseAllKeyShopGamePage(mockHtml, 'https://example.com/deal');
      expect(offers.length).toBe(2);

      const k4g = offers.find(o => o.merchantCode === 'k4g');
      expect(k4g).toBeDefined();
      expect(k4g?.priceEur).toBe(0.63); // uses priceCard (with credit card fees!)
      expect(k4g?.rawPrice).toBe(0.21); // bare key price
      expect(k4g?.originalPriceEur).toBe(0.25);
      expect(k4g?.voucherCode).toBe('AKS14DEAL');

      const wyrel = offers.find(o => o.merchantCode === 'wyrel');
      expect(wyrel).toBeDefined();
      expect(wyrel?.priceEur).toBe(1.09); // uses priceCard (€1.05 + €0.04 card fee)
      expect(wyrel?.rawPrice).toBe(1.05);
      expect(wyrel?.originalPriceEur).toBe(1.24);
      expect(wyrel?.voucherCode).toBe('allkeyshop');
    });
  });

  describe('parseAllKeyShopPriceHistory Recency Snapshot Sorting', () => {
    it('selects the most recent price snapshot per merchant instead of an expired cheaper historical entry', () => {
      const payload: any = {
        history: [
          {
            merchant_id: 1001,
            edition: 1,
            region: 2,
            min_discount_price: 0.45,
            last_price: 0.53,
            best_discount_code: 'allkeyshop',
            start: '2026-09-15 00:26:30',
            end: '2026-09-15 10:34:30' // Expired yesterday
          },
          {
            merchant_id: 1001,
            edition: 1,
            region: 2,
            min_discount_price: 1.05,
            last_price: 1.24,
            best_discount_code: 'allkeyshop',
            start: '2026-09-16 15:04:05',
            end: '2026-09-16 15:04:05' // Active today
          }
        ],
        merchants: { '1001': { name: 'Wyrel' } },
        editions: { '1': { name: 'Standard' } },
        regions: { '2': { name: 'Global' } },
        officialMerchants: []
      };

      const offers = parseAllKeyShopPriceHistory(payload, 'https://example.com/wyrel');
      expect(offers.length).toBe(1);
      // MUST be today's active price (€1.05), NOT yesterday's expired €0.45!
      expect(offers[0].priceEur).toBe(1.05);
      expect(offers[0].originalPriceEur).toBe(1.24);
    });

    it('discards <= 0.05 EUR phantom prices/coupon artifacts in parseAllKeyShopGamePage', () => {
      const mockHtml = `
        <html><body><script>
        var gamePageTrans = {
          "merchants": { "100": { "name": "Kinguin" } },
          "editions": { "1": { "name": "Standard" } },
          "regions": { "2": { "name": "Global" } },
          "prices": [
            {
              "id": 1,
              "merchant": 100,
              "price": 0.02,
              "priceCard": 0.02,
              "voucher_code": "AKSPREORDER",
              "account": false,
              "dispo": 1,
              "activationPlatform": "steam"
            }
          ]
        };
        </script></body></html>
      `;

      const offers = parseAllKeyShopGamePage(mockHtml, 'https://example.com/deal');
      expect(offers.length).toBe(0);
    });

    it('discards <= 0.05 EUR phantom prices/coupon artifacts in parseAllKeyShopPriceHistory', () => {
      const payload: any = {
        history: [
          {
            merchant_id: 1001,
            edition: 1,
            region: 2,
            min_discount_price: 0.02,
            last_price: 0.02,
            best_discount_code: 'AKSPREORDER',
            start: '2026-09-17 00:00:00',
            end: '2026-09-17 10:00:00'
          }
        ],
        merchants: { '1001': { name: 'Kinguin' } },
        editions: { '1': { name: 'Standard' } },
        regions: { '2': { name: 'Global' } },
        officialMerchants: []
      };

      const offers = parseAllKeyShopPriceHistory(payload, 'https://example.com/kinguin');
      expect(offers.length).toBe(0);
    });
  });
});
