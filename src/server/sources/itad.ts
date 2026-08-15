import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { gameRepo } from '../db/index.js';

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
    games: { steamAppId: number; title: string; itadId?: string }[]
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();
    if (!config.itadApiKey || games.length === 0) return resultMap;

    // 1. Separate games with and without known ITAD IDs
    const itadIdToAppId = new Map<string, number>();
    const itadIdsToFetch: string[] = [];

    for (const g of games) {
      if (g.itadId) {
        itadIdToAppId.set(g.itadId, g.steamAppId);
        itadIdsToFetch.push(g.itadId);
      }
    }

    // 2. Chunk in batches of 150 items
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

        // 1. Record historical low if present
        if (item.historyLow?.price?.amount !== undefined) {
          const histPrice = Number(item.historyLow.price.amount);
          const histDate = item.historyLow.cut ? new Date().toISOString() : undefined;
          const game = gameRepo.getBySteamAppId(steamAppId);
          if (game) {
            gameRepo.updateHistoricalLow(game.id, histPrice, histDate || new Date().toISOString(), `ITAD (${item.historyLow.shop?.name || 'Store'})`);
          }
        }

        // 2. Record current best deal
        if (item.current?.price?.amount !== undefined) {
          const shop = item.current.shop || {};
          const shopCode = (shop.name || 'Store').toLowerCase().replace(/[^a-z0-9]+/g, '');
          
          offers.push({
            merchantCode: shopCode,
            merchantName: shop.name || 'Store',
            isOfficial: true,
            productTypeRaw: 'STEAM_KEY',
            regionRaw: 'GLOBAL',
            priceEur: Number(item.current.price.amount),
            originalPriceEur: item.current.regular?.amount ? Number(item.current.regular.amount) : undefined,
            voucherCode: item.current.voucher || undefined,
            dealUrl: item.current.url || `https://isthereanydeal.com/game/${itadId}/info/`,
            historicalLowEur: item.historyLow?.price?.amount ? Number(item.historyLow.price.amount) : undefined,
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
