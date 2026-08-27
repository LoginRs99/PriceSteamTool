import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncOrchestrator } from '../../src/server/sync/orchestrator.js';
import { steamAdapter } from '../../src/server/sources/steam.js';
import { itadAdapter } from '../../src/server/sources/itad.js';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { ggdealsAdapter } from '../../src/server/sources/ggdeals.js';
import { allkeyshopAdapter } from '../../src/server/sources/allkeyshop.js';
import { gameRepo, profileRepo, sourceRepo, offerRepo, merchantRepo } from '../../src/server/db/index.js';
import { circuitBreakers } from '../../src/server/sync/circuitBreaker.js';
import { config } from '../../src/server/config/index.js';

describe('Source-Only and Selective Sync Semantics', () => {
  let orchestrator: SyncOrchestrator;
  let testProfile: any;
  let idCounter = 100;
  const origSolverUrl = config.allkeyshopSolverUrl;
  const origAksEnabled = config.allkeyshopEnabled;
  const origGgKey = config.ggdealsApiKey;

  beforeEach(() => {
    circuitBreakers.resetAll();
    config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';
    config.allkeyshopEnabled = true;
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
    config.allkeyshopSolverUrl = origSolverUrl;
    config.allkeyshopEnabled = origAksEnabled;
    config.ggdealsApiKey = origGgKey;
    vi.restoreAllMocks();
  });

  it('1. allkeyshop-only sync: executes ONLY AllKeyShop and does not execute Steam, ITAD, CheapShark, or GG.deals', async () => {
    const steamWishlistSpy = vi.spyOn(steamAdapter, 'fetchWishlist').mockResolvedValue([
      { steamAppId: 101, title: 'Game Alpha', priority: 1, isDlc: false, isFree: false, discountPercent: 0 },
      { steamAppId: 102, title: 'Game Beta', priority: 2, isDlc: false, isFree: false, discountPercent: 0 }
    ]);
    const steamPriceSpy = vi.spyOn(steamAdapter, 'fetchPricesForGame').mockResolvedValue([]);
    const itadSpy = vi.spyOn(itadAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const cheapsharkSpy = vi.spyOn(cheapsharkAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const ggdealsSpy = vi.spyOn(ggdealsAdapter, 'fetchBatchPrices').mockResolvedValue(new Map());
    const aksPriceSpy = vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValue([
      {
        merchantCode: 'k4g',
        merchantName: 'K4G',
        priceEur: 12.50,
        dealUrl: 'https://k4g.example/game',
        isOfficial: false,
        productTypeRaw: 'STEAM_KEY',
        regionRaw: 'GLOBAL'
      }
    ]);

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['allkeyshop']);

    // Wishlist metadata was ingested
    expect(steamWishlistSpy).toHaveBeenCalledTimes(1);

    // Unselected price sources were NEVER called
    expect(steamPriceSpy).not.toHaveBeenCalled();
    expect(itadSpy).not.toHaveBeenCalled();
    expect(cheapsharkSpy).not.toHaveBeenCalled();
    expect(ggdealsSpy).not.toHaveBeenCalled();

    // AllKeyShop WAS called
    expect(aksPriceSpy).toHaveBeenCalled();

    // Check progress badges
    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam.total).toBe(0);
    expect(progress.sourceProgress.steam.processed).toBe(0);
    expect(progress.sourceProgress.itad.total).toBe(0);
    expect(progress.sourceProgress.cheapshark.total).toBe(0);
    expect(progress.sourceProgress.ggdeals.total).toBe(0);

    // AllKeyShop progress is populated
    expect(progress.sourceProgress.allkeyshop.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.allkeyshop.processed).toBe(progress.sourceProgress.allkeyshop.total);
    expect(progress.sourceProgress.allkeyshop.offersFound).toBeGreaterThan(0);

    // Final message is AllKeyShop specific
    expect(progress.currentAction).toContain('AllKeyShop');
    expect(progress.currentAction).not.toContain('official & batch deals');
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
    const aksPriceSpy = vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValue([]);

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['steam']);

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).not.toHaveBeenCalled();
    expect(aksPriceSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.steam.processed).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad.total).toBe(0);
    expect(progress.sourceProgress.allkeyshop.total).toBe(0);

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
    const aksPriceSpy = vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValue([]);

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['itad']);

    expect(itadSpy).toHaveBeenCalled();
    expect(steamPriceSpy).not.toHaveBeenCalled();
    expect(csSpy).not.toHaveBeenCalled();
    expect(aksPriceSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.itad.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad.processed).toBeGreaterThan(0);
    expect(progress.sourceProgress.steam.total).toBe(0);

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
    const aksPriceSpy = vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValue([]);

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL', ['steam', 'itad']);

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).toHaveBeenCalled();
    expect(csSpy).not.toHaveBeenCalled();
    expect(ggSpy).not.toHaveBeenCalled();
    expect(aksPriceSpy).not.toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.cheapshark.total).toBe(0);
    expect(progress.sourceProgress.allkeyshop.total).toBe(0);

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
    const aksPriceSpy = vi.spyOn(allkeyshopAdapter, 'fetchPricesForGame').mockResolvedValue([]);

    await orchestrator.executeSync(testProfile.id, testProfile.steamId, testProfile.name, true, 'MANUAL');

    expect(steamPriceSpy).toHaveBeenCalled();
    expect(itadSpy).toHaveBeenCalled();
    expect(csSpy).toHaveBeenCalled();
    expect(ggSpy).toHaveBeenCalled();
    expect(aksPriceSpy).toHaveBeenCalled();

    const progress = orchestrator.getProgress();
    expect(progress.sourceProgress.steam.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.itad.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.cheapshark.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.ggdeals.total).toBeGreaterThan(0);
    expect(progress.sourceProgress.allkeyshop.total).toBeGreaterThan(0);
  });
});
