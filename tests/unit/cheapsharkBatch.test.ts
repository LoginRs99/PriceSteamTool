import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { getDb, gameRepo } from '../../src/server/db/index.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM anomalies;
    DELETE FROM offers;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM merchants;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}

describe('CheapShark Batch Source Adapter', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetDatabase();
    circuitBreakers.recordSuccess('cheapshark');
    (cheapsharkAdapter as any).storesMap.clear();
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([
          { storeID: '1', storeName: 'Steam', isActive: 1 },
          { storeID: '15', storeName: 'Fanatical', isActive: 1 }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const match = urlStr.match(/steamAppID=(\d+)/);
      const appId = match ? match[1] : '1091500';
      return new Response(JSON.stringify([
        {
          steamAppID: appId,
          storeID: '1',
          dealID: `mockDeal_${appId}`,
          salePrice: '29.99',
          normalPrice: '59.99',
          isOnSale: '1'
        }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('supportsBatch should be true and code should be cheapshark', () => {
    expect(cheapsharkAdapter.supportsBatch).toBe(true);
    expect(cheapsharkAdapter.code).toBe('cheapshark');
    expect(cheapsharkAdapter.isEnabled()).toBe(true);
  });

  it('fetchBatchPrices handles empty game list gracefully', async () => {
    const results = await cheapsharkAdapter.fetchBatchPrices([]);
    expect(results.size).toBe(0);
  });

  it('fetchBatchPrices returns valid Map for game queries with onProgress reporting', async () => {
    let progressCalls = 0;
    const progressSpy = (processed: number, total: number, _action?: string) => {
      progressCalls++;
      expect(total).toBe(2);
      expect(processed).toBeGreaterThanOrEqual(0);
    };

    const games = [
      { steamAppId: 1091500, title: 'Cyberpunk 2077' },
      { steamAppId: 292030, title: 'The Witcher 3: Wild Hunt' }
    ];

    const results = await cheapsharkAdapter.fetchBatchPrices(games, progressSpy);
    expect(results).toBeInstanceOf(Map);
    expect(results.has(1091500)).toBe(true);
    const offers = results.get(1091500)!;
    expect(offers.length).toBe(1);
    expect(offers[0].merchantName).toBe('Steam');
    expect(progressCalls).toBeGreaterThan(0);
  });

  it('throws aggregated error when all chunks fail and sets requestCount', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([{ storeID: '1', storeName: 'Steam', isActive: 1 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('CheapShark network error 500');
    };

    const games = [{ steamAppId: 1091500, title: 'Cyberpunk 2077' }];
    await expect(cheapsharkAdapter.fetchBatchPrices(games)).rejects.toThrow(/All 1 CheapShark chunks failed/);
  });

  it('verifies identity before updating historical low in fetchPricesForGame', async () => {
    const game = gameRepo.upsert({ steamAppId: 1091500, title: 'Cyberpunk 2077', basePriceEur: 59.99 });
    const updateAtlSpy = vi.spyOn(gameRepo, 'updateHistoricalLow');

    // 1. Mismatched steamAppID returned from /games endpoint (e.g. sound track with app ID 99999)
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([{ storeID: '1', storeName: 'Steam', isActive: 1 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/deals')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/games')) {
        return new Response(JSON.stringify([
          {
            gameID: '1234',
            steamAppID: '99999', // Mismatched App ID!
            cheapestPriceEver: { price: '4.99', date: 1600000000 }
          }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}');
    };

    await cheapsharkAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(updateAtlSpy).not.toHaveBeenCalled();

    // 2. Matching steamAppID returned from /games endpoint
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([{ storeID: '1', storeName: 'Steam', isActive: 1 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/deals')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/games')) {
        return new Response(JSON.stringify([
          {
            gameID: '1234',
            steamAppID: '1091500', // Correct matching App ID
            cheapestPriceEver: { price: '4.99', date: 1600000000 }
          }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}');
    };

    await cheapsharkAdapter.fetchPricesForGame(1091500, 'Cyberpunk 2077');
    expect(updateAtlSpy).toHaveBeenCalledWith(game.id, expect.any(Number), expect.any(String), 'CheapShark');
  });
});
