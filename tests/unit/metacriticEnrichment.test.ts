import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('Metacritic Score & URL Enrichment from CheapShark', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetDatabase();
    circuitBreakers.recordSuccess('cheapshark');
    (cheapsharkAdapter as any).storesMap.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts Metacritic score and formatted URL when present in CheapShark deals', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([
          { storeID: '1', storeName: 'Steam', isActive: 1 }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/deals')) {
        return new Response(JSON.stringify([
          {
            steamAppID: '331600',
            storeID: '1',
            dealID: 'deal_op3',
            salePrice: '4.99',
            normalPrice: '39.99',
            metacriticScore: '62',
            metacriticLink: '/game/one-piece-pirate-warriors-3/'
          }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    // Pre-insert game without Metacritic
    gameRepo.upsert({
      steamAppId: 331600,
      title: 'One Piece Pirate Warriors 3'
    });

    const before = gameRepo.getBySteamAppId(331600);
    expect(before?.metacriticScore).toBeUndefined();
    expect(before?.metacriticUrl).toBeUndefined();

    const offers = await cheapsharkAdapter.fetchPricesForGame(331600, 'One Piece Pirate Warriors 3');
    expect(offers.length).toBe(1);
    expect(offers[0].metacriticScore).toBe(62);
    expect(offers[0].metacriticUrl).toBe('https://www.metacritic.com/game/one-piece-pirate-warriors-3/');

    // Database should be enriched automatically
    const after = gameRepo.getBySteamAppId(331600);
    expect(after?.metacriticScore).toBe(62);
    expect(after?.metacriticUrl).toBe('https://www.metacritic.com/game/one-piece-pirate-warriors-3/');
  });

  it('gracefully handles missing or "0" Metacritic score from CheapShark deals', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([
          { storeID: '1', storeName: 'Steam', isActive: 1 }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/deals')) {
        return new Response(JSON.stringify([
          {
            steamAppID: '999999',
            storeID: '1',
            dealID: 'deal_unknown',
            salePrice: '9.99',
            normalPrice: '19.99',
            metacriticScore: '0',
            metacriticLink: null
          }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const offers = await cheapsharkAdapter.fetchPricesForGame(999999, 'Indie Game Without Metacritic');
    expect(offers.length).toBe(1);
    expect(offers[0].metacriticScore).toBeUndefined();
    expect(offers[0].metacriticUrl).toBeUndefined();
  });

  it('fetchBatchPrices correctly extracts Metacritic data across multiple games', async () => {
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/stores')) {
        return new Response(JSON.stringify([
          { storeID: '1', storeName: 'Steam', isActive: 1 }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const match = urlStr.match(/steamAppID=(\d+)/);
      const appId = match ? match[1] : '100';
      return new Response(JSON.stringify([
        {
          steamAppID: appId,
          storeID: '1',
          dealID: `deal_${appId}`,
          salePrice: '14.99',
          normalPrice: '29.99',
          metacriticScore: appId === '331600' ? '62' : '88',
          metacriticLink: appId === '331600' ? '/game/one-piece-pirate-warriors-3/' : 'https://www.metacritic.com/game/hit-game/'
        }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const games = [
      { steamAppId: 331600, title: 'One Piece Pirate Warriors 3' },
      { steamAppId: 1086940, title: 'Baldurs Gate 3' }
    ];

    const results = await cheapsharkAdapter.fetchBatchPrices(games);
    expect(results.size).toBe(2);

    const op3Offers = results.get(331600);
    expect(op3Offers?.[0].metacriticScore).toBe(62);
    expect(op3Offers?.[0].metacriticUrl).toBe('https://www.metacritic.com/game/one-piece-pirate-warriors-3/');

    const bg3Offers = results.get(1086940);
    expect(bg3Offers?.[0].metacriticScore).toBe(88);
    expect(bg3Offers?.[0].metacriticUrl).toBe('https://www.metacritic.com/game/hit-game/');
  });
});
