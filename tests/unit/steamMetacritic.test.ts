import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('Steam Wishlist Metacritic Data Flow', () => {
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
    circuitBreakers.resetAll();
    global.fetch = origFetch;
    config.delays.steam = origSteamDelay;
    (steamAdapter as any).queue.minIntervalMs = origInterval;
    (steamAdapter as any).queue.jitterMs = origJitter;
  });

  it('correctly extracts metacriticUrl from metacritic_fullurl, metacritic.url, and metacritic_url', async () => {
    let pageCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('wishlistdata')) {
        if (pageCount === 0) {
          pageCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({
              100: {
                name: 'Game 1',
                metacritic_score: 85,
                metacritic_fullurl: 'https://www.metacritic.com/game/pc/game-1'
              },
              101: {
                name: 'Game 2',
                metacritic: {
                  score: 90,
                  url: 'https://www.metacritic.com/game/pc/game-2'
                }
              },
              102: {
                name: 'Game 3',
                metacritic_score: '75',
                metacritic_url: 'https://www.metacritic.com/game/pc/game-3'
              },
              103: {
                name: 'Game 4'
              }
            })),
            headers: new Headers()
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({})),
          headers: new Headers()
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
        headers: new Headers()
      });
    });

    const items = await steamAdapter.fetchWishlist('76561198000000000');

    expect(items).toHaveLength(4);

    const g1 = items.find(i => i.steamAppId === 100);
    expect(g1?.metacriticScore).toBe(85);
    expect(g1?.metacriticUrl).toBe('https://www.metacritic.com/game/pc/game-1');

    const g2 = items.find(i => i.steamAppId === 101);
    expect(g2?.metacriticScore).toBe(90);
    expect(g2?.metacriticUrl).toBe('https://www.metacritic.com/game/pc/game-2');

    const g3 = items.find(i => i.steamAppId === 102);
    expect(g3?.metacriticScore).toBe(75);
    expect(g3?.metacriticUrl).toBe('https://www.metacritic.com/game/pc/game-3');

    const g4 = items.find(i => i.steamAppId === 103);
    expect(g4?.metacriticScore).toBeUndefined();
    expect(g4?.metacriticUrl).toBeUndefined();
  });
});
