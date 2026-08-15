import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { convertToEur } from '../domain/normalizer.js';
import { gameRepo } from '../db/index.js';

interface CheapSharkStore {
  storeID: string;
  storeName: string;
  isActive: number;
}

export class CheapSharkSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'cheapshark' as const;
  public readonly name = 'CheapShark';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('cheapshark', config.delays.cheapshark, 200);
  private storesMap = new Map<string, string>();
  private lastStoreFetch = 0;

  public isEnabled(): boolean {
    return true;
  }

  private async ensureStores(): Promise<void> {
    const now = Date.now();
    // Cache for 24 hours
    if (this.storesMap.size > 0 && (now - this.lastStoreFetch) < 24 * 60 * 60 * 1000) {
      return;
    }

    try {
      const stores: CheapSharkStore[] = await safeFetchJson('https://www.cheapshark.com/api/1.0/stores');
      this.storesMap.clear();
      for (const s of stores) {
        if (s.isActive) {
          this.storesMap.set(s.storeID, s.storeName);
        }
      }
      this.lastStoreFetch = now;
    } catch (e) {
      // Fallback default store names
      if (this.storesMap.size === 0) {
        this.storesMap.set('1', 'Steam');
        this.storesMap.set('2', 'GamersGate');
        this.storesMap.set('3', 'GreenManGaming');
        this.storesMap.set('7', 'GOG');
        this.storesMap.set('11', 'Humble Store');
        this.storesMap.set('15', 'Fanatical');
        this.storesMap.set('23', 'GameBillet');
        this.storesMap.set('25', 'Epic Games Store');
      }
    }
  }

  /**
   * Batch fetches deals for multiple games using comma-separated steamAppIDs (up to 50 per call)
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();
    if (games.length === 0) return resultMap;

    await this.ensureStores();

    const chunkSize = 50;
    let processed = 0;

    for (let i = 0; i < games.length; i += chunkSize) {
      const chunk = games.slice(i, i + chunkSize);
      const appIds = chunk.map(g => g.steamAppId).filter(id => id > 0);
      if (appIds.length === 0) continue;

      try {
        const batchResults = await this.queue.enqueue(async () => {
          const url = `https://www.cheapshark.com/api/1.0/deals?steamAppID=${appIds.join(',')}&pageSize=60`;
          const deals: any = await safeFetchJson(url);
          return Array.isArray(deals) ? deals : [];
        });

        for (const d of batchResults) {
          const appId = parseInt(d.steamAppID, 10);
          if (!appId) continue;

          const storeName = this.storesMap.get(String(d.storeID)) || `Store ${d.storeID}`;
          const merchantCode = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '');
          const salePriceUsd = parseFloat(d.salePrice || '0');
          const retailPriceUsd = parseFloat(d.normalPrice || '0');

          const priceEur = convertToEur(salePriceUsd, 'USD');
          const originalPriceEur = retailPriceUsd > 0 ? convertToEur(retailPriceUsd, 'USD') : undefined;

          const offer: NormalizedSourceOffer = {
            merchantCode,
            merchantName: storeName,
            isOfficial: true,
            productTypeRaw: 'STEAM_KEY',
            regionRaw: 'GLOBAL',
            priceEur,
            originalPriceEur,
            rawPrice: salePriceUsd,
            rawCurrency: 'USD',
            rawOriginalPrice: retailPriceUsd > 0 ? retailPriceUsd : undefined,
            dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID || '')}`,
            rawPayload: d
          };

          const existing = resultMap.get(appId) || [];
          existing.push(offer);
          resultMap.set(appId, existing);
        }
      } catch (err: any) {
        // Individual chunk failure gracefully handled
      }

      processed += chunk.length;
      if (onProgress) {
        onProgress(Math.min(processed, games.length), games.length, `CheapShark: ${Math.min(processed, games.length)}/${games.length} games checked...`);
      }
    }

    return resultMap;
  }

  /**
   * Single-game lookup fallback
   */
  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    await this.ensureStores();

    return this.queue.enqueue(async () => {
      const offers: NormalizedSourceOffer[] = [];
      try {
        const url = `https://www.cheapshark.com/api/1.0/deals?steamAppID=${steamAppId}`;
        const deals: any = await safeFetchJson(url);

        if (Array.isArray(deals)) {
          for (const d of deals) {
            const storeName = this.storesMap.get(String(d.storeID)) || `Store ${d.storeID}`;
            const merchantCode = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '');
            const salePriceUsd = parseFloat(d.salePrice || '0');
            const retailPriceUsd = parseFloat(d.normalPrice || '0');

            const priceEur = convertToEur(salePriceUsd, 'USD');
            const originalPriceEur = retailPriceUsd > 0 ? convertToEur(retailPriceUsd, 'USD') : undefined;

            offers.push({
              merchantCode,
              merchantName: storeName,
              isOfficial: true,
              productTypeRaw: 'STEAM_KEY',
              regionRaw: 'GLOBAL',
              priceEur,
              originalPriceEur,
              rawPrice: salePriceUsd,
              rawCurrency: 'USD',
              rawOriginalPrice: retailPriceUsd > 0 ? retailPriceUsd : undefined,
              dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID || '')}`,
              rawPayload: d
            });
          }
        }

        // Check historical low
        const gamesUrl = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle)}&limit=1`;
        const gameResults: any = await safeFetchJson(gamesUrl);
        if (Array.isArray(gameResults) && gameResults.length > 0 && gameResults[0].cheapestPriceEver) {
          const cpe = gameResults[0].cheapestPriceEver;
          const histEur = convertToEur(parseFloat(cpe.price), 'USD');
          const histDate = cpe.date ? new Date(cpe.date * 1000).toISOString() : new Date().toISOString();
          
          const game = gameRepo.getBySteamAppId(steamAppId);
          if (game) {
            gameRepo.updateHistoricalLow(game.id, histEur, histDate, 'CheapShark');
          }
        }
      } catch (err: any) {
        if (err?.status === 404) return [];
        throw err;
      }

      return offers;
    });
  }
}

export const cheapsharkAdapter = new CheapSharkSourceAdapter();
