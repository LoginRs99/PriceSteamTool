import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { superDuperBundleAdapter } from '../../src/server/sources/superduperbundle.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('SuperDuperBundle Source Adapter', () => {
  const originalFetch = global.fetch;
  const originalEnabled = config.superduperbundleEnabled;
  const originalApiKey = config.superduperbundleApiKey;

  beforeEach(() => {
    circuitBreakers.resetAll();
    superDuperBundleAdapter.clearQueue();
    config.superduperbundleEnabled = true;
    config.superduperbundleApiKey = '';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    superDuperBundleAdapter.clearQueue();
    circuitBreakers.resetAll();
    config.superduperbundleEnabled = originalEnabled;
    config.superduperbundleApiKey = originalApiKey;
  });

  it('has expected metadata and status', () => {
    expect(superDuperBundleAdapter.code).toBe('superduperbundle');
    expect(superDuperBundleAdapter.name).toBe('SuperDuperBundle');
    expect(superDuperBundleAdapter.supportsBatch).toBe(true);
    expect(superDuperBundleAdapter.isEnabled()).toBe(true);

    config.superduperbundleEnabled = false;
    expect(superDuperBundleAdapter.isEnabled()).toBe(false);
  });

  it('fetchPricesForGame parses offers, converts USD to EUR and classifies store types', async () => {
    const mockResponse = {
      api: 'superduperbundle',
      count: 1,
      results: [
        {
          id: 'sdb_cyberpunk_2077',
          name: 'Cyberpunk 2077',
          steam_app_id: 1091500,
          url: 'https://superduperbundle.com/game/sdb_cyberpunk_2077/',
          currency: 'USD',
          offers: [
            {
              store: 'steam',
              store_name: 'Steam Store',
              store_type: 'official',
              price: 29.99,
              drm: 'Steam',
              region: 'Global'
            },
            {
              store: 'fanatical',
              store_name: 'Fanatical',
              store_type: 'retailer',
              price: 25.49,
              drm: 'Steam',
              region: 'EU'
            },
            {
              store: 'kinguin',
              store_name: 'Kinguin',
              store_type: 'marketplace',
              price: 19.99,
              drm: 'Steam',
              region: 'Global'
            },
            {
              store: 'outofstock',
              store_name: 'Out Of Stock Store',
              store_type: 'retailer',
              price: 0,
              drm: 'Steam'
            }
          ]
        }
      ]
    };

    global.fetch = async () => {
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const offers = await superDuperBundleAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(offers.length).toBe(3); // 0 price offer is excluded

    // Official store offer
    const steamOffer = offers.find(o => o.merchantName === 'Steam Store');
    expect(steamOffer).toBeDefined();
    expect(steamOffer?.isOfficial).toBe(true);
    expect(steamOffer?.rawCurrency).toBe('USD');
    expect(steamOffer?.rawPrice).toBe(29.99);
    expect(steamOffer?.priceEur).toBeGreaterThan(0);
    expect(steamOffer?.dealUrl).toBe('https://superduperbundle.com/game/sdb_cyberpunk_2077/');

    // Retailer offer
    const fanaticalOffer = offers.find(o => o.merchantName === 'Fanatical');
    expect(fanaticalOffer).toBeDefined();
    expect(fanaticalOffer?.isOfficial).toBe(true);

    // Marketplace offer
    const kinguinOffer = offers.find(o => o.merchantName === 'Kinguin');
    expect(kinguinOffer).toBeDefined();
    expect(kinguinOffer?.isOfficial).toBe(false);
  });

  it('fetchPricesForGame respects dynamic currency from API result (e.g. EUR)', async () => {
    const mockResponse = {
      api: 'superduperbundle',
      count: 1,
      results: [
        {
          id: 'sdb_witcher_3',
          name: 'The Witcher 3',
          steam_app_id: 292030,
          url: 'https://superduperbundle.com/game/sdb_witcher_3/',
          currency: 'EUR',
          offers: [
            {
              store: 'steam',
              store_name: 'Steam Store',
              store_type: 'official',
              price: 19.99,
              drm: 'Steam',
              region: 'Global'
            }
          ]
        }
      ]
    };

    global.fetch = async () => {
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const offers = await superDuperBundleAdapter.fetchPricesForGame(292030, 'The Witcher 3');
    expect(offers.length).toBe(1);
    expect(offers[0].priceEur).toBe(19.99); // 1:1 EUR conversion
    expect(offers[0].rawCurrency).toBe('EUR');
  });

  it('fetchPricesForGame falls back to lowest_steam_key when offers array is empty', async () => {
    const mockResponse = {
      api: 'superduperbundle',
      count: 1,
      results: [
        {
          id: 'sdb_hades',
          name: 'Hades',
          steam_app_id: 1145360,
          url: 'https://superduperbundle.com/game/sdb_hades/',
          currency: 'USD',
          offers: [], // empty offers list
          lowest_steam_key: {
            store: 'kinguin',
            store_name: 'Kinguin',
            store_type: 'marketplace',
            price: 11.99,
            drm: 'Steam',
            region: 'Global'
          }
        }
      ]
    };

    global.fetch = async () => {
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const offers = await superDuperBundleAdapter.fetchPricesForGame(1145360, 'Hades');
    expect(offers.length).toBe(1);
    expect(offers[0].merchantName).toBe('Kinguin');
    expect(offers[0].rawPrice).toBe(11.99);
    expect(offers[0].rawCurrency).toBe('USD');
  });

  it('fetchPricesForGame returns empty array when circuit breaker is cooling down', async () => {
    circuitBreakers.setCooldown('superduperbundle', 60000, 'Test cooldown');

    const offers = await superDuperBundleAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(offers).toEqual([]);
  });

  it('fetchPricesForGame returns empty array on network failure and records circuit breaker failure', async () => {
    const recordSpy = vi.spyOn(circuitBreakers, 'recordFailure');
    global.fetch = async () => {
      throw new Error('Network timeout 504');
    };

    const offers = await superDuperBundleAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(offers).toEqual([]);
    expect(recordSpy).toHaveBeenCalledWith('superduperbundle', expect.any(String));
    recordSpy.mockRestore();
  });

  it('fetchBatchPrices chunks requests into groups of 50 and reports progress', async () => {
    const fetchedUrls: string[] = [];

    global.fetch = async (url: any) => {
      const urlStr = String(url);
      fetchedUrls.push(urlStr);

      const match = urlStr.match(/steam_ids=([^&]+)/);
      const ids = match ? match[1].split(',') : [];

      const results = ids.map(id => ({
        id: `sdb_${id}`,
        name: `Game ${id}`,
        steam_app_id: Number(id),
        url: `https://superduperbundle.com/game/sdb_${id}/`,
        currency: 'USD',
        offers: [
          {
            store: 'gmg',
            store_name: 'Green Man Gaming',
            store_type: 'official',
            price: 15.00,
            drm: 'Steam',
            region: 'Global'
          }
        ]
      }));

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    // Generate 65 games to verify chunking (50 + 15)
    const testGames = Array.from({ length: 65 }, (_, idx) => ({
      steamAppId: 1000 + idx,
      title: `Game ${1000 + idx}`
    }));

    let progressReports = 0;
    const progressCallback = (processed: number, total: number, _action?: string) => {
      progressReports++;
      expect(total).toBe(65);
      expect(processed).toBeGreaterThan(0);
    };

    const batchResults = await superDuperBundleAdapter.fetchBatchPrices(testGames, progressCallback);

    expect(fetchedUrls.length).toBe(2);
    expect(fetchedUrls[0]).toContain('steam_ids=');
    // First chunk has 50 IDs
    const firstChunkIds = fetchedUrls[0].match(/steam_ids=([^&]+)/)![1].split(',');
    expect(firstChunkIds.length).toBe(50);

    // Second chunk has 15 IDs
    const secondChunkIds = fetchedUrls[1].match(/steam_ids=([^&]+)/)![1].split(',');
    expect(secondChunkIds.length).toBe(15);

    expect(batchResults.size).toBe(65);
    expect(batchResults.get(1000)?.length).toBe(1);
    expect(progressReports).toBeGreaterThanOrEqual(2);
  });

  it('passes X-API-Key header when configured in config', async () => {
    config.superduperbundleApiKey = 'sdb_secret_key_123';
    let apiKeyFound: string | null = null;

    global.fetch = async (_url: any, init?: any) => {
      const headers = init?.headers;
      if (headers instanceof Headers) {
        apiKeyFound = headers.get('x-api-key') || headers.get('X-API-Key');
      } else if (headers && typeof headers === 'object') {
        apiKeyFound = headers['X-API-Key'] || headers['x-api-key'] || null;
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await superDuperBundleAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(apiKeyFound).toBe('sdb_secret_key_123');
  });
  it('fetchBatchPrices retries transient failures and continues to subsequent chunks', async () => {
    let callCount = 0;
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      callCount++;
      if (urlStr.includes('steam_ids=2001') && callCount === 1) {
        return new Response('Gateway timeout', { status: 504 });
      }
      return new Response(JSON.stringify({
        results: [
          {
            id: 'sdb_test',
            name: 'Test Game',
            steam_app_id: 2001,
            offers: [{ store: 'eneba', store_name: 'Eneba', store_type: 'marketplace', price: 15.0, drm: 'Steam', region: 'Global' }]
          }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const games = [{ steamAppId: 2001, title: 'Game 2001' }];
    const res = await superDuperBundleAdapter.fetchBatchPrices(games);
    expect(res.size).toBe(1);
    expect(res.get(2001)?.[0].priceEur).toBeGreaterThan(0);
    expect(callCount).toBe(2);
  });

  it('fetchBatchPrices is resilient: chunk failure does not abort remaining chunks', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('3001')) {
        return new Response('Server Error', { status: 500 });
      }
      return new Response(JSON.stringify({
        results: [
          {
            id: 'sdb_3051',
            name: 'Game 3051',
            steam_app_id: 3051,
            offers: [{ store: 'eneba', store_name: 'Eneba', store_type: 'marketplace', price: 20.0, drm: 'Steam', region: 'Global' }]
          }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const games = Array.from({ length: 51 }, (_, i) => ({ steamAppId: 3001 + i, title: `Game ${3001 + i}` }));
    const res = await superDuperBundleAdapter.fetchBatchPrices(games);

    expect(res.has(3051)).toBe(true);
    expect((res as any).failedChunks).toBe(1);
  });
});
