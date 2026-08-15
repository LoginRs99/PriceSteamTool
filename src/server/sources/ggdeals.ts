import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { gameRepo } from '../db/index.js';

export interface GGDealsPriceData {
  title: string;
  url: string;
  prices: {
    currentRetail: string | null;
    currentKeyshops: string | null;
    historicalRetail: string | null;
    historicalKeyshops: string | null;
    currency: string;
  };
}

export class GGDealsSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'ggdeals' as const;
  public readonly name = 'GG.deals';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('ggdeals', config.delays.ggdeals, 250);

  public isEnabled(): boolean {
    return Boolean(config.ggdealsApiKey);
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    if (!config.ggdealsApiKey) return [];
    const batchMap = await this.fetchBatchPrices([{ steamAppId, title: gameTitle }]);
    return batchMap.get(steamAppId) || [];
  }

  /**
   * Fetches prices for up to 100 Steam App IDs per batch request
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[]
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();
    if (!config.ggdealsApiKey || games.length === 0) return resultMap;

    const chunkSize = 100;
    for (let i = 0; i < games.length; i += chunkSize) {
      if (i > 0) {
        // GG.deals allows 100 records per minute; pause 60s between 100-record batch chunks
        await new Promise(r => setTimeout(r, 60000));
      }
      const chunk = games.slice(i, i + chunkSize);
      const appIds = chunk.map(g => g.steamAppId);
      
      const chunkResult = await this.queryAppIdsBatch(appIds);
      for (const [appId, offers] of chunkResult.entries()) {
        resultMap.set(appId, offers);
      }
    }

    return resultMap;
  }

  private async queryAppIdsBatch(appIds: number[]): Promise<Map<number, NormalizedSourceOffer[]>> {
    return this.queue.enqueue(async () => {
      const resultMap = new Map<number, NormalizedSourceOffer[]>();
      if (appIds.length === 0) return resultMap;

      const region = config.preferredCountry.toLowerCase() === 'hu' ? 'eu' : config.preferredCountry.toLowerCase();
      const url = `https://api.gg.deals/v1/prices/by-steam-app-id/?ids=${appIds.join(',')}&key=${config.ggdealsApiKey}&region=${region}`;

      try {
        const response: any = await safeFetchJson(url);
        if (!response?.success || !response?.data) {
          return resultMap;
        }

        for (const [appIdStr, item] of Object.entries(response.data)) {
          const appId = parseInt(appIdStr, 10);
          if (!item || typeof item !== 'object') continue;

          const data = item as GGDealsPriceData;
          const offers: NormalizedSourceOffer[] = [];
          const game = gameRepo.getBySteamAppId(appId);

          // 1. Check historical retail low
          if (data.prices.historicalRetail) {
            const histRetail = parseFloat(data.prices.historicalRetail);
            if (!isNaN(histRetail) && histRetail > 0 && game) {
              gameRepo.updateHistoricalLow(game.id, histRetail, new Date().toISOString(), 'GG.deals (Official)');
            }
          }

          // 2. Add current retail price if available
          if (data.prices.currentRetail) {
            const priceEur = parseFloat(data.prices.currentRetail);
            if (!isNaN(priceEur) && priceEur > 0) {
              offers.push({
                merchantCode: 'ggdeals_retail',
                merchantName: 'GG.deals (Official)',
                isOfficial: true,
                productTypeRaw: 'STEAM_KEY',
                regionRaw: 'EU',
                priceEur,
                dealUrl: data.url || `https://gg.deals/game/${appId}/`,
                historicalLowEur: data.prices.historicalRetail ? parseFloat(data.prices.historicalRetail) : undefined,
                rawPayload: data
              });
            }
          }

          // 3. Add current keyshop price if available
          if (data.prices.currentKeyshops) {
            const priceEur = parseFloat(data.prices.currentKeyshops);
            if (!isNaN(priceEur) && priceEur > 0) {
              offers.push({
                merchantCode: 'ggdeals_keyshops',
                merchantName: 'GG.deals (Keyshops)',
                isOfficial: false,
                productTypeRaw: 'STEAM_KEY',
                regionRaw: 'GLOBAL',
                priceEur,
                dealUrl: data.url || `https://gg.deals/game/${appId}/`,
                historicalLowEur: data.prices.historicalKeyshops ? parseFloat(data.prices.historicalKeyshops) : undefined,
                rawPayload: data
              });
            }
          }

          if (offers.length > 0) {
            resultMap.set(appId, offers);
          }
        }
      } catch (err: any) {
        if (err?.status === 404 || err?.status === 401) {
          return resultMap;
        }
        throw err;
      }

      return resultMap;
    });
  }
}

export const ggdealsAdapter = new GGDealsSourceAdapter();
