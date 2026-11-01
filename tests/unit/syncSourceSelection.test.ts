import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { ggdealsAdapter } from '../../src/server/sources/ggdeals.js';
import { gameRepo, profileRepo, sourceRepo, offerRepo, merchantRepo } from '../../src/server/db/index.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('Source-Only and Selective Sync Semantics', () => {
  let orchestrator: SyncOrchestrator;
  let testProfile: any;
  let idCounter = 100;
  const origGgKey = config.ggdealsApiKey;

  beforeEach(() => {
    circuitBreakers.resetAll();
    config.ggdealsApiKey = 'test-gg-key';

    for (const src of sourceRepo.list()) {
      if (!src.isEnabled) {
        sourceRepo.toggle(src.code, true);
      }
    }

    orchestrator = new SyncOrchestrator();
    idCounter++;
    const uniqueSteamId = '7656' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90000 + 10000);
    testProfile = profileRepo.create(`Source Select User ${idCounter}`, uniqueSteamId);

    // Create a mock wishlist in DB
    const g1 = gameRepo.upsert({ steamAppId: 101, title: 'Game Alpha', basePriceEur: 29.99 });
    const g2 = gameRepo.upsert({ steamAppId: 102, title: 'Game Beta', basePriceEur: 49.99 });
    gameRepo.syncWishlistEntries(testProfile.id, [
      { steamAppId: 101, title: 'Game Alpha', priority: 1 },
      { steamAppId: 102, title: 'Game Beta', priority: 2 }
    ]);
  });

  afterEach(() => {
    config.ggdealsApiKey = origGgKey;
    vi.restoreAllMocks();
  });

  it('1. cheapshark-only sync: executes ONLY CheapShark and does not execute Steam storefront pricing or ITAD', async () => {
    const steamWishlistSpy = vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const cheapsharkSpy = vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map([
      [101, [{
        merchantCode: 'gamersgate',
        merchantName: 'GamersGate',
        priceEur: 14.99,
        originalPriceEur: 29.99,
        dealUrl: 'https://gamersgate.example/game',
        isOfficial: true,
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }]]
    ]));

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['cheapshark']);

    expect(steamWishlistSpy).toHaveBeenCalledTimes(1);
    expect(steamPriceSpy).not.toHaveBeenCalled();
    expect(itadSpy).not.toHaveBeenCalled();
    expect(cheapsharkSpy).toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam?.total || 0).toBe(0);
    expect(progress.sourceProgress.itad?.total || 0).toBe(0);
    expect(progress.sourceProgress.cheapshark?.total).toBeGreaterThan(0);
    expect(progress.currentAction).toContain('CheapShark');
  });

  it('2. steam-only sync: executes ONLY Steam storefront price refresh', async () => {
    vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([
      {
        merchantCode: 'steam',
        merchantName: 'Steam Store',
        priceEur: 19.99,
        originalPriceEur: 29.99,
        dealUrl: 'https://store.steampowered.com/app/101',
        isOfficial: true,
        productTypeRaw: 'DIRECT_PURCHASE',
        regionRaw: 'GLOBAL'
      }
    ]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['steam']);

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.steam!.processed).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad!.total).toBe(0);

    expect(progress.currentAction).toBe('Steam Store refresh complete for 2 games.');
  });

  it('3. itad-only sync: executes ONLY ITAD batch refresh', async () => {
    vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map([
      [101, [{
        merchantCode: 'fanatical',
        merchantName: 'Fanatical',
        priceEur: 15.00,
        dealUrl: 'https://fanatical.example/101',
        isOfficial: true,
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }]]
    ]));
    const csSpy = vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['itad']);

    expect(itadSpy).toHaveBeenCalled();
    expect(steamPriceSpy).not.toHaveBeenCalled();
    expect(csSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.itad!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad!.processed).toBeGreaterThan(0);
    expect(progress.sourceProgress.steam!.total).toBe(0);

    expect(progress.currentAction).toBe('IsThereAnyDeal refresh complete for 2 games.');
  });

  it('4. combined steam + itad sync: executes ONLY Steam and ITAD', async () => {
    vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const csSpy = vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const ggSpy = vi.spyOn(ggdealsAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['steam', 'itad']);

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).toHaveBeenCalled();
    expect(csSpy).not.toHaveBeenCalled();
    expect(ggSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.cheapshark!.total).toBe(0);

    expect(progress.currentAction).toBe('Steam Store, IsThereAnyDeal refresh complete for 2 games.');
  });

  it('5. default sync without selectedSources: executes all enabled sources with default message', async () => {
    vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const csSpy = vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const ggSpy = vi.spyOn(ggdealsAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL');

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).toHaveBeenCalled();
    expect(csSpy).toHaveBeenCalled();
    expect(ggSpy).toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.cheapshark!.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.ggdeals!.total).toBeGreaterThan(0);
  });
});
