import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, gameRepo, merchantRepo, offerRepo, profileRepo, sourceRepo } from '../../src/server/db/index.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { ggdealsAdapter } from '../../src/server/sources/ggdeals.js';
import { allkeyshopAdapter } from '../../src/server/sources/allkeyshop.js';

describe('Per-Game Force Refresh — P1 Suite', () => {
  beforeEach(() => {
    circuitBreakers.resetAll();
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM games;
      DELETE FROM merchants;
      DELETE FROM profiles;
    `);
  });

  it('performs parallel fast refresh across Steam, ITAD, CheapShark, and GG.deals', async () => {
    const profile = profileRepo.create('Test User', '76561198000000001');
    const game = gameRepo.upsert({ steamAppId: 1086940, title: "Baldur's Gate 3", basePriceEur: 59.99 });

    // Mock fast sources
    vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'steam',
        merchantName: 'Steam Store',
        isOfficial: true,
        priceEur: 59.99,
        originalPriceEur: 59.99,
        discountPercent: 0,
        dealUrl: 'https://store.steampowered.com/app/1086940',
        productTypeRaw: 'DIRECT_PURCHASE',
        regionRaw: 'GLOBAL'
      }
    ]);

    vi.spyOn(itadAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'fanatical',
        merchantName: 'Fanatical',
        isOfficial: true,
        priceEur: 49.99,
        originalPriceEur: 59.99,
        discountPercent: 17,
        dealUrl: 'https://fanatical.com/bg3',
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }
    ]);

    vi.spyOn(cheapsharkAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'gamersgate',
        merchantName: 'GamersGate',
        isOfficial: true,
        priceEur: 45.99,
        originalPriceEur: 59.99,
        discountPercent: 23,
        dealUrl: 'https://gamersgate.com/bg3',
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }
    ]);

    vi.spyOn(ggdealsAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'greenmangaming',
        merchantName: 'Green Man Gaming',
        isOfficial: true,
        priceEur: 44.50,
        originalPriceEur: 59.99,
        discountPercent: 26,
        dealUrl: 'https://gmg.com/bg3',
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }
    ]);

    // Mock AllKeyShop background fetch
    vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'kinguin',
        merchantName: 'Kinguin',
        isOfficial: false,
        priceEur: 39.99,
        originalPriceEur: 59.99,
        discountPercent: 33,
        dealUrl: 'https://kinguin.net/bg3',
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }
    ]);

    const result = await syncOrchestrator.refreshGame(game.id);

    expect(result.success).toBe(true);
    expect(result.sourcesChecked).toEqual(expect.arrayContaining(['steam', 'itad', 'cheapshark', 'ggdeals']));
    expect(result.sourcesFailed).toEqual([]);
    expect(result.offers.length).toBeGreaterThanOrEqual(4);

    // Verify best deal recomputed
    const bestOffer = result.offers.find((o: any) => o.isBestDeal);
    expect(bestOffer).toBeDefined();
    expect(bestOffer?.priceEur).toBeLessThanOrEqual(45.00);
  });

  it('handles partial failures gracefully without aborting remaining sources', async () => {
    const profile = profileRepo.create('Test User', '76561198000000002');
    const game = gameRepo.upsert({ steamAppId: 1091500, title: 'Cyberpunk 2077', basePriceEur: 59.99 });

    vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValueOnce([
      {
        merchantCode: 'steam',
        merchantName: 'Steam Store',
        isOfficial: true,
        priceEur: 29.99,
        originalPriceEur: 59.99,
        discountPercent: 50,
        dealUrl: 'https://store.steampowered.com/app/1091500',
        productTypeRaw: 'DIRECT_PURCHASE',
        regionRaw: 'GLOBAL'
      }
    ]);

    // ITAD throws error
    vi.spyOn(itadAdapter, 'fetchPricesForGame').mockRejectedValueOnce(new Error('ITAD Service Unavailable'));

    vi.spyOn(cheapsharkAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);
    vi.spyOn(ggdealsAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);
    vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);

    const result = await syncOrchestrator.refreshGame(game.id);

    expect(result.success).toBe(true);
    expect(result.sourcesChecked).toContain('itad');
    expect(result.sourcesFailed).toContain('itad');
    expect(result.offers.length).toBe(1);
    expect(result.offers[0].priceEur).toBe(29.99);
  });

  it('honors circuit breaker tripping and skips execution for broken sources', async () => {
    const profile = profileRepo.create('Test User', '76561198000000003');
    const game = gameRepo.upsert({ steamAppId: 730, title: 'Counter-Strike 2', basePriceEur: 14.99 });

    // Manually trip cheapshark circuit breaker into PAUSED
    for (let i = 0; i < 5; i++) {
      circuitBreakers.recordFailure('cheapshark', new Error('CheapShark down'));
    }
    expect(circuitBreakers.canExecute('cheapshark').allowed).toBe(false);

    vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);
    vi.spyOn(itadAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);
    const csSpy = vi.spyOn(cheapsharkAdapter, 'fetchPricesForGame');
    vi.spyOn(ggdealsAdapter, 'fetchPricesForGame').mockResolvedValueOnce([]);

    const result = await syncOrchestrator.refreshGame(game.id, { includeKeyshops: false });

    expect(result.sourcesSkipped).toContain('cheapshark');
    expect(csSpy).not.toHaveBeenCalled();
  });
});
