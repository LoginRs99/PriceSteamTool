import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { gameRepo } from '../db/index.js';
import { convertToEur } from '../domain/normalizer.js';

export class ItadSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'itad' as const;
  public readonly name = 'IsThereAnyDeal';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('itad', config.delays.itad, 150);

  public isEnabled(): boolean {
    // Enabled by default; if API key is present, it uses official API, otherwise falls back gracefully
    return true;
  }

  /**
   * Looks up ITAD UUID for a Steam AppID
   */
  public async lookupItadId(steamAppId: number): Promise<string | null> {
    if (!config.itadApiKey) return null;

    return this.queue.enqueue(async () => {
      try {
        const url = `https://api.isthereanydeal.com/games/lookup/v1?key=${config.itadApiKey}&appid=${steamAppId}`;
        const data: any = await safeFetchJson(url);
        if (data?.game?.id) {
          gameRepo.updateItadId(steamAppId, data.game.id);
          return data.game.id;
        }
      } catch (err: any) {
        if (err.status === 404) return null;
        throw err;
      }
      return null;
    });
  }

  /**
   * Fetches prices for a single game
   */
  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string, 
    itadId?: string
  ): Promise<NormalizedSourceOffer[]> {
    if (!config.itadApiKey) return [];

    let resolvedItadId = itadId;
    if (!resolvedItadId) {
      resolvedItadId = (await this.lookupItadId(steamAppId)) || undefined;
    }

    if (!resolvedItadId) return [];

    const batchMap = await this.fetchBatchOverview([resolvedItadId], new Map([[resolvedItadId, steamAppId]]));
    return batchMap.get(steamAppId) || [];
  }

  /**
   * Fetches batch overview and prices for multiple games simultaneously (up to 200 per call)
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();
    if (!config.itadApiKey || games.length === 0) return resultMap;

    const itadIdToAppId = new Map<string, number>();
    const itadIdsToFetch: string[] = [];
    const gamesNeedingLookup: { steamAppId: number; title: string }[] = [];

    // 1. Separate games with known ITAD IDs
    for (const g of games) {
      if (g.itadId) {
        itadIdToAppId.set(g.itadId, g.steamAppId);
        itadIdsToFetch.push(g.itadId);
      } else {
        gamesNeedingLookup.push(g);
      }
    }

    let processedCount = games.length - gamesNeedingLookup.length;
    if (onProgress) {
      onProgress(processedCount, games.length, `ITAD: ${processedCount}/${games.length} IDs cached, resolving ${gamesNeedingLookup.length}...`);
    }

    // 2. Concurrently resolve missing ITAD IDs (concurrency: 8)
    if (gamesNeedingLookup.length > 0) {
      const concurrency = 8;
      let currentIndex = 0;

      const worker = async () => {
        while (currentIndex < gamesNeedingLookup.length) {
          const idx = currentIndex++;
          if (idx >= gamesNeedingLookup.length) break;
          const g = gamesNeedingLookup[idx];

          try {
            const itadId = await this.lookupItadId(g.steamAppId);
            if (itadId) {
              itadIdToAppId.set(itadId, g.steamAppId);
              itadIdsToFetch.push(itadId);
            }
          } catch {
            // Ignore individual lookup errors
          } finally {
            processedCount++;
            if (onProgress && (processedCount % 10 === 0 || processedCount === games.length)) {
              onProgress(processedCount, games.length, `Resolving ITAD IDs (${processedCount}/${games.length})...`);
            }
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, gamesNeedingLookup.length) }, () => worker());
      await Promise.all(workers);
    }

    if (onProgress) {
      onProgress(games.length, games.length, `Fetching ITAD price overviews for ${itadIdsToFetch.length} games...`);
    }

    // 3. Chunk in batches of 150 items for games/overview/v2
    const chunkSize = 150;
    for (let i = 0; i < itadIdsToFetch.length; i += chunkSize) {
      const chunk = itadIdsToFetch.slice(i, i + chunkSize);
      const chunkResults = await this.fetchBatchOverview(chunk, itadIdToAppId);
      
      for (const [appId, offers] of chunkResults.entries()) {
        resultMap.set(appId, offers);
      }
    }

    return resultMap;
  }

  private async fetchBatchOverview(
    itadIds: string[], 
    itadIdToAppId: Map<string, number>
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    return this.queue.enqueue(async () => {
      const resultMap = new Map<number, NormalizedSourceOffer[]>();
      if (itadIds.length === 0) return resultMap;

      const url = `https://api.isthereanydeal.com/games/overview/v2?key=${config.itadApiKey}&country=${config.preferredCountry}`;
      
      const response: any = await safeFetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(itadIds)
      });

      if (!response?.prices || !Array.isArray(response.prices)) {
        return resultMap;
      }

      for (const item of response.prices) {
        const itadId = item.id;
        const steamAppId = itadIdToAppId.get(itadId);
        if (!steamAppId) continue;

        const offers: NormalizedSourceOffer[] = [];

        const itemCurrency = item.current?.price?.currency || item.lowest?.price?.currency || 'EUR';
        const rawCurrentPrice = item.current?.price?.amount !== undefined ? Number(item.current.price.amount) : undefined;
        const rawRegularPrice = item.current?.regular?.amount !== undefined ? Number(item.current.regular.amount) : undefined;

        // 1. Record historical low if present
        const lowObj = item.lowest || item.historyLow;
        if (lowObj?.price?.amount !== undefined) {
          const rawHistPrice = Number(lowObj.price.amount);
          const histCurrency = lowObj.price.currency || itemCurrency;
          const histPrice = convertToEur(rawHistPrice, histCurrency);
          const histDate = lowObj.timestamp || (lowObj.cut ? new Date().toISOString() : undefined);
          const game = gameRepo.getBySteamAppId(steamAppId);
          if (game) {
            gameRepo.updateHistoricalLow(game.id, histPrice, histDate || new Date().toISOString(), `ITAD (${lowObj.shop?.name || 'Store'})`);
          }
        }

        // 2. Record current best deal
        if (rawCurrentPrice !== undefined) {
          const shop = item.current.shop || {};
          const shopName = shop.name || 'Store';
          const shopCode = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '');
          const priceEur = convertToEur(rawCurrentPrice, itemCurrency);
          const originalPriceEur = rawRegularPrice !== undefined ? convertToEur(rawRegularPrice, itemCurrency) : undefined;
          
          // Check DRM array from ITAD v2
          const drms = Array.isArray(item.current.drm)
            ? item.current.drm.map((d: any) => typeof d === 'string' ? d : d?.name || '').filter(Boolean)
            : [];
          
          const isNonSteamShop = ['gog', 'epic games', 'ubisoft', 'ea app', 'origin', 'battle.net', 'blizzard', 'microsoft'].some(s => shopName.toLowerCase().includes(s));
          const hasSteamDrm = drms.some((d: string) => d.toLowerCase().includes('steam'));

          let productTypeRaw = 'Steam Key';
          if (drms.length > 0 && !hasSteamDrm) {
            productTypeRaw = `${drms.join(', ')} (Non-Steam)`;
          } else if (isNonSteamShop && !hasSteamDrm) {
            productTypeRaw = `${shopName} (Non-Steam)`;
          } else if (shopName.toLowerCase().includes('steam store') || shopName.toLowerCase() === 'steam') {
            productTypeRaw = 'Direct Purchase';
          }

          offers.push({
            merchantCode: shopCode,
            merchantName: shopName,
            isOfficial: true,
            productTypeRaw,
            regionRaw: 'GLOBAL',
            priceEur,
            originalPriceEur,
            rawPrice: rawCurrentPrice,
            rawCurrency: itemCurrency,
            rawOriginalPrice: rawRegularPrice,
            voucherCode: item.current.voucher || undefined,
            dealUrl: item.current.url || `https://isthereanydeal.com/game/${itadId}/info/`,
            historicalLowEur: lowObj?.price?.amount ? convertToEur(Number(lowObj.price.amount), itemCurrency) : undefined,
            rawPayload: item
          });
        }

        if (offers.length > 0) {
          resultMap.set(steamAppId, offers);
        }
      }

      return resultMap;
    });
  }
}

export const itadAdapter = new ItadSourceAdapter();
