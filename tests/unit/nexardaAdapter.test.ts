import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nexardaAdapter } from '../../src/server/sources/nexarda.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';
import { gameRepo } from '../../src/server/db/index.js';

describe('NEXARDA Source Adapter', () => {
  const originalFetch = global.fetch;
  const originalEnabled = config.nexardaEnabled;

  beforeEach(() => {
    circuitBreakers.resetAll();
    nexardaAdapter.clearQueue();
    nexardaAdapter.clearCache();
    config.nexardaEnabled = true;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    nexardaAdapter.clearQueue();
    nexardaAdapter.clearCache();
    circuitBreakers.resetAll();
    config.nexardaEnabled = originalEnabled;
    vi.restoreAllMocks();
  });

  it('has expected metadata and status', () => {
    expect(nexardaAdapter.code).toBe('nexarda');
    expect(nexardaAdapter.name).toBe('NEXARDA');
    expect(nexardaAdapter.supportsBatch).toBe(true);
    expect(nexardaAdapter.isEnabled()).toBe(true);

    config.nexardaEnabled = false;
    expect(nexardaAdapter.isEnabled()).toBe(false);
  });

  describe('resolveNexardaId', () => {
    it('resolves ID from in-memory cache directly without network calls', async () => {
      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({}), { status: 200 });
      };

      (nexardaAdapter as any).idCache.set(1091500, 4567);
      const id = await nexardaAdapter.resolveNexardaId(1091500);

      expect(id).toBe(4567);
      expect(fetchCalled).toBe(false);
    });

    it('resolves ID from game repository when present in DB', async () => {
      let fetchCalled = false;
      global.fetch = async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({}), { status: 200 });
      };

      vi.spyOn(gameRepo, 'getBySteamAppId').mockReturnValue({
        id: 'game-1',
        steamAppId: 1091500,
        title: 'Cyberpunk 2077',
        nexardaId: 8888
      } as any);

      const id = await nexardaAdapter.resolveNexardaId(1091500);
      expect(id).toBe(8888);
      expect(fetchCalled).toBe(false);
    });

    it('queries /api/v3/find?steam=... and updates DB and cache on success', async () => {
      vi.spyOn(gameRepo, 'getBySteamAppId').mockReturnValue(null as any);
      const updateSpy = vi.spyOn(gameRepo, 'updateNexardaId').mockImplementation(() => {});

      let requestedUrl = '';
      global.fetch = async (url: any) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
          success: true,
          code: 'game_found',
          game: {
            id: 12345,
            name: 'Hades II'
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const id = await nexardaAdapter.resolveNexardaId(1145350, 'Hades II');
      expect(id).toBe(12345);
      expect(requestedUrl).toContain('/api/v3/find?steam=1145350');
      expect(updateSpy).toHaveBeenCalledWith(1145350, 12345);
    });

    it('falls back to /api/v3/search?type=games&q=... when direct find fails', async () => {
      vi.spyOn(gameRepo, 'getBySteamAppId').mockReturnValue(null as any);
      const updateSpy = vi.spyOn(gameRepo, 'updateNexardaId').mockImplementation(() => {});

      const calls: string[] = [];
      global.fetch = async (url: any) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/find')) {
          return new Response(JSON.stringify({
            success: false,
            code: 'game_not_found'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (u.includes('/search')) {
          return new Response(JSON.stringify({
            success: true,
            code: 'search_results',
            results: {
              items: [
                {
                  type: 'game',
                  title: 'Elden Ring',
                  game_info: { id: 99901, name: 'Elden Ring' }
                }
              ]
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not found', { status: 404 });
      };

      const id = await nexardaAdapter.resolveNexardaId(1245620, 'Elden Ring™');
      expect(id).toBe(99901);
      expect(calls.some(c => c.includes('/find'))).toBe(true);
      expect(calls.some(c => c.includes('/search'))).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith(1245620, 99901);
    });

    it('selects correct candidate by score and avoids sequel collision (items[0] trap)', async () => {
      vi.spyOn(gameRepo, 'getBySteamAppId').mockReturnValue(null as any);
      const updateSpy = vi.spyOn(gameRepo, 'updateNexardaId').mockImplementation(() => {});

      global.fetch = async (url: any) => {
        const u = String(url);
        if (u.includes('/find')) {
          return new Response(JSON.stringify({ success: false, code: 'game_not_found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (u.includes('/search')) {
          return new Response(JSON.stringify({
            success: true,
            code: 'search_results',
            results: {
              items: [
                // items[0] is Max Payne 3 (sequel collision)
                { type: 'game', title: 'Max Payne 3 (2012)', game_info: { id: 648, name: 'Max Payne 3' } },
                // items[1] is Max Payne 2
                { type: 'game', title: 'Max Payne 2: The Fall of Max Payne', game_info: { id: 651, name: 'Max Payne 2: The Fall of Max Payne' } },
                // items[2] is the true match!
                { type: 'game', title: 'Max Payne (2001)', game_info: { id: 652, name: 'Max Payne' } }
              ]
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not found', { status: 404 });
      };

      // Searching for Max Payne (12140) must choose ID 652 (Max Payne 1), NOT 648 (Max Payne 3)!
      const id = await nexardaAdapter.resolveNexardaId(12140, 'Max Payne');
      expect(id).toBe(652);
      expect(updateSpy).toHaveBeenCalledWith(12140, 652);
    });

    it('detects and heals poisoned stored nexardaId when prices API returns mismatched game', async () => {
      (nexardaAdapter as any).idCache.set(12140, 648); // 648 is Max Payne 3
      const updateSpy = vi.spyOn(gameRepo, 'updateNexardaId').mockImplementation(() => {});

      global.fetch = async () => {
        return new Response(JSON.stringify({
          success: true,
          code: 'game_prices_found',
          info: {
            id: 648,
            name: 'Max Payne 3', // mismatch for target "Max Payne"
            slug: 'max-payne-3'
          },
          prices: {
            currency: 'EUR',
            list: [
              {
                url: 'https://store.steampowered.com/app/204100',
                store: { name: 'Steam', official: true },
                edition: 'Standard',
                region: 'Global',
                platform: 'Steam',
                available: true,
                price: 19.99
              }
            ]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const offers = await nexardaAdapter.fetchPricesForGame(12140, 'Max Payne');
      expect(offers).toEqual([]); // Mismatch rejected
      expect((nexardaAdapter as any).idCache.has(12140)).toBe(false); // Cache cleared
      expect(updateSpy).toHaveBeenCalledWith(12140, null); // DB cleared
    });

    it('returns null when both find and search fail', async () => {
      vi.spyOn(gameRepo, 'getBySteamAppId').mockReturnValue(null as any);
      global.fetch = async () => {
        return new Response(JSON.stringify({ success: false, code: 'game_not_found' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const id = await nexardaAdapter.resolveNexardaId(9999999, 'Unknown Indie Title');
      expect(id).toBeNull();
    });
  });

  describe('fetchPricesForGame', () => {
    it('parses valid EUR offers, extracts voucher codes and filters invalid items', async () => {
      // Mock ID resolution to return id 555
      (nexardaAdapter as any).idCache.set(1091500, 555);

      const mockPricesResponse = {
        success: true,
        code: 'game_prices_found',
        info: {
          id: 555,
          name: 'Cyberpunk 2077',
          slug: 'cyberpunk-2077'
        },
        prices: {
          currency: 'EUR',
          lowest: 19.99,
          stores: 4,
          list: [
            {
              url: 'https://store.steampowered.com/app/1091500',
              store: {
                name: 'Steam',
                type: 'Official Store',
                official: true
              },
              edition: 'Standard Edition',
              region: 'Global',
              platform: 'Steam',
              available: true,
              price: 29.99
            },
            {
              url: 'https://www.gamivo.com/product/cyberpunk-2077',
              store: {
                name: 'GAMIVO',
                type: 'Marketplace',
                official: false
              },
              edition: 'Standard Edition',
              region: 'Europe',
              platform: 'PC',
              available: true,
              price: 18.50,
              coupon: {
                available: true,
                code: 'SAVENOW',
                discount: 10,
                price_without: 20.55
              }
            },
            {
              url: 'https://www.eneba.com/cyberpunk-2077-ps5',
              store: {
                name: 'Eneba',
                type: 'Marketplace',
                official: false
              },
              edition: 'Standard Edition',
              region: 'Global',
              platform: 'PlayStation 5', // Non-PC/Steam platform should be filtered out
              available: true,
              price: 15.00
            },
            {
              url: 'https://kinguin.net/item',
              store: {
                name: 'Kinguin',
                type: 'Marketplace',
                official: false
              },
              edition: 'Standard Edition',
              region: 'Global',
              platform: 'Steam',
              available: false, // Out of stock should be filtered out
              price: -1
            }
          ]
        }
      };

      global.fetch = async () => {
        return new Response(JSON.stringify(mockPricesResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const offers = await nexardaAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
      expect(offers.length).toBe(2);

      // Check official Steam offer
      const steamOffer = offers.find(o => o.merchantName === 'Steam');
      expect(steamOffer).toBeDefined();
      expect(steamOffer?.isOfficial).toBe(true);
      expect(steamOffer?.priceEur).toBe(29.99);
      expect(steamOffer?.rawCurrency).toBe('EUR');

      // Check GAMIVO offer with coupon
      const gamivoOffer = offers.find(o => o.merchantName === 'GAMIVO');
      expect(gamivoOffer).toBeDefined();
      expect(gamivoOffer?.isOfficial).toBe(false);
      expect(gamivoOffer?.priceEur).toBe(18.50);
      expect(gamivoOffer?.voucherCode).toBe('SAVENOW');
      expect(gamivoOffer?.originalPriceEur).toBe(20.55);
    });

    it('returns empty array when circuit breaker is cooling down', async () => {
      circuitBreakers.setCooldown('nexarda', 60000, 'Test cooldown');

      const offers = await nexardaAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
      expect(offers).toEqual([]);
    });

    it('returns empty array on network failure and records circuit breaker failure', async () => {
      (nexardaAdapter as any).idCache.set(1091500, 555);
      const recordSpy = vi.spyOn(circuitBreakers, 'recordFailure');

      global.fetch = async () => {
        throw new Error('Nexarda 500 Server Error');
      };

      const offers = await nexardaAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
      expect(offers).toEqual([]);
      expect(recordSpy).toHaveBeenCalledWith('nexarda', expect.any(String));
      recordSpy.mockRestore();
    });

    it('clears cached and database ID on HTTP 400 or 404 when game does not exist, without tripping circuit breaker', async () => {
      (nexardaAdapter as any).idCache.set(1091500, 99999);
      const recordSpy = vi.spyOn(circuitBreakers, 'recordFailure');
      const updateNexardaIdSpy = vi.spyOn(gameRepo, 'updateNexardaId');

      global.fetch = async () => {
        const err: any = new Error('HTTP 400 Bad Request for https://www.nexarda.com/api/v3/prices?type=game&id=99999&currency=EUR - Given game does not exist.');
        err.status = 400;
        throw err;
      };

      const offers = await nexardaAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
      expect(offers).toEqual([]);
      // Must NOT record circuit breaker failure
      expect(recordSpy).not.toHaveBeenCalled();
      // Must clear cache and DB
      expect((nexardaAdapter as any).idCache.has(1091500)).toBe(false);
      expect(updateNexardaIdSpy).toHaveBeenCalledWith(1091500, null);

      recordSpy.mockRestore();
      updateNexardaIdSpy.mockRestore();
    });

    it('records circuit breaker failure and preserves cached ID on generic 400 without does-not-exist notice', async () => {
      (nexardaAdapter as any).idCache.set(1091500, 99999);
      const recordSpy = vi.spyOn(circuitBreakers, 'recordFailure');
      const updateNexardaIdSpy = vi.spyOn(gameRepo, 'updateNexardaId');

      global.fetch = async () => {
        const err: any = new Error('HTTP 400 Bad Request for https://www.nexarda.com/api/v3/prices?type=game&id=99999&currency=EUR - Invalid query parameter');
        err.status = 400;
        throw err;
      };

      const offers = await nexardaAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
      expect(offers).toEqual([]);
      // Must record circuit breaker failure for generic 400
      expect(recordSpy).toHaveBeenCalledWith('nexarda', expect.any(String));
      // Must NOT clear cache or DB
      expect((nexardaAdapter as any).idCache.has(1091500)).toBe(true);
      expect(updateNexardaIdSpy).not.toHaveBeenCalled();

      recordSpy.mockRestore();
      updateNexardaIdSpy.mockRestore();
    });
  });

  describe('fetchBatchPrices', () => {
    it('handles empty input gracefully', async () => {
      const res = await nexardaAdapter.fetchBatchPrices([]);
      expect(res.size).toBe(0);
    });

    it('iterates games and reports progress', async () => {
      (nexardaAdapter as any).idCache.set(1001, 10);
      (nexardaAdapter as any).idCache.set(1002, 20);

      global.fetch = async (url: any) => {
        const u = String(url);
        const idMatch = u.match(/id=(\d+)/);
        const nid = idMatch ? idMatch[1] : '1';
        return new Response(JSON.stringify({
          success: true,
          code: 'game_prices_found',
          prices: {
            currency: 'EUR',
            list: [
              {
                url: `https://example.com/deal/${nid}`,
                store: { name: 'Fanatical', official: true },
                edition: 'Standard',
                region: 'Global',
                platform: 'Steam',
                available: true,
                price: 12.99
              }
            ]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      let progressCount = 0;
      const progressFn = (processed: number, total: number, _action?: string) => {
        progressCount++;
        expect(total).toBe(2);
        expect(processed).toBeGreaterThan(0);
      };

      const games = [
        { steamAppId: 1001, title: 'Game A' },
        { steamAppId: 1002, title: 'Game B' }
      ];

      const res = await nexardaAdapter.fetchBatchPrices(games, progressFn);
      expect(res.size).toBe(2);
      expect(res.has(1001)).toBe(true);
      expect(res.has(1002)).toBe(true);
      expect(res.get(1001)?.[0].priceEur).toBe(12.99);
      expect(progressCount).toBeGreaterThan(0);
    });

    it('honors 300s, 600s, and larger requested upstream Retry-After headers without early retry', async () => {
      circuitBreakers.reset('nexarda');
      (nexardaAdapter as any).idCache.set(1001, 10);

      // 1. Simulate 429 with Retry-After: 300
      global.fetch = async () => new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '300' }
      });

      const res300 = await nexardaAdapter.fetchPricesForGame(1001, 'Cyberpunk 2077');
      expect(res300).toEqual([]);
      expect(circuitBreakers.canExecute('nexarda').allowed).toBe(false);
      let remaining = circuitBreakers.getRemainingCooldownSec('nexarda');
      expect(remaining).toBeGreaterThanOrEqual(295);
      expect(remaining).toBeLessThanOrEqual(300);

      // 2. Simulate 429 with Retry-After: 600 (must NOT be capped to 300s)
      circuitBreakers.reset('nexarda');
      global.fetch = async () => new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '600' }
      });

      const res600 = await nexardaAdapter.fetchPricesForGame(1001, 'Cyberpunk 2077');
      expect(res600).toEqual([]);
      expect(circuitBreakers.canExecute('nexarda').allowed).toBe(false);
      remaining = circuitBreakers.getRemainingCooldownSec('nexarda');
      expect(remaining).toBeGreaterThanOrEqual(595);
      expect(remaining).toBeLessThanOrEqual(600);

      // 3. Simulate 429 with Retry-After: 1200
      circuitBreakers.reset('nexarda');
      global.fetch = async () => new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '1200' }
      });

      const res1200 = await nexardaAdapter.fetchPricesForGame(1001, 'Cyberpunk 2077');
      expect(res1200).toEqual([]);
      expect(circuitBreakers.canExecute('nexarda').allowed).toBe(false);
      remaining = circuitBreakers.getRemainingCooldownSec('nexarda');
      expect(remaining).toBeGreaterThanOrEqual(1195);
      expect(remaining).toBeLessThanOrEqual(1200);
    });
  });
});
