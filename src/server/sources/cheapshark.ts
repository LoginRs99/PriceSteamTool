import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { convertToEur } from '../domain/normalizer.js';
import { gameRepo } from '../db/index.js';
import { logWarn } from '../utils/logger.js';

interface CheapSharkStore {
  storeID: string;
  storeName: string;
  isActive: number;
}

export class CheapSharkSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'cheapshark' as const;
  public readonly name = 'CheapShark';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('cheapshark', config.delays.cheapshark, 250);
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

  private parseOfferFromDeal(d: any): NormalizedSourceOffer {
    const storeName = this.storesMap.get(String(d.storeID)) || `Store ${d.storeID}`;
    const merchantCode = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const salePriceUsd = parseFloat(d.salePrice || '0');
    const retailPriceUsd = parseFloat(d.normalPrice || '0');

    const isNonSteamStore = ['gog', 'origin', 'uplay', 'epic games', 'blizzard', 'battlenet', 'microsoft store', 'xbox'].some(s => storeName.toLowerCase().includes(s));
    const productTypeRaw = isNonSteamStore ? `${storeName} (Non-Steam)` : (d.storeID === '1' ? 'Direct Purchase' : 'Steam Key');

    const priceEur = convertToEur(salePriceUsd, 'USD');
    const originalPriceEur = retailPriceUsd > 0 ? convertToEur(retailPriceUsd, 'USD') : undefined;

    const rawMetaScore = parseInt(d.metacriticScore, 10);
    const metacriticScore = (!isNaN(rawMetaScore) && rawMetaScore > 0) ? rawMetaScore : undefined;
    let metacriticUrl: string | undefined = undefined;
    if (d.metacriticLink && typeof d.metacriticLink === 'string' && d.metacriticLink.trim()) {
      const link = d.metacriticLink.trim();
      metacriticUrl = link.startsWith('http') ? link : `https://www.metacritic.com${link.startsWith('/') ? '' : '/'}${link}`;
    }

    return {
      merchantCode,
      merchantName: storeName,
      isOfficial: true,
      productTypeRaw,
      regionRaw: 'GLOBAL',
      priceEur,
      originalPriceEur,
      rawPrice: salePriceUsd,
      rawCurrency: 'USD',
      rawOriginalPrice: retailPriceUsd > 0 ? retailPriceUsd : undefined,
      dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.dealID || '')}`,
      rawPayload: d,
      metacriticScore,
      metacriticUrl
    };
  }

  /**
   * Batch fetches deals for multiple games using CheapShark's multi-SteamAppID support.
   * Groups app IDs into batches of 25 (well under URL length and page limits),
   * pacing each batch through PacedSourceQueue with exponential jitter and 429 backoff.
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();
    if (games.length === 0) return resultMap;

    await this.ensureStores();

    const batchSize = 25;
    let processed = 0;
    let failedChunks = 0;
    let totalChunks = 0;
    let totalRequestsMade = 0;

    for (let i = 0; i < games.length; i += batchSize) {
      const chunk = games.slice(i, i + batchSize);
      const appIds = chunk.map(g => g.steamAppId).filter(id => id > 0);
      if (appIds.length === 0) {
        processed += chunk.length;
        continue;
      }

      const chunkIndex = totalChunks;
      totalChunks++;

      let batchSucceeded = false;
      for (let attempt = 0; attempt < 2 && !batchSucceeded; attempt++) {
        try {
          await this.queue.enqueue(async () => {
            let pageNumber = 0;
            let hasMorePages = true;
            const maxPages = 3; // Safety cap to avoid infinite pagination loops

            while (hasMorePages && pageNumber < maxPages) {
              totalRequestsMade++;
              const url = `https://www.cheapshark.com/api/1.0/deals?steamAppID=${appIds.join(',')}&pageSize=60&pageNumber=${pageNumber}`;
              const deals: any = await safeFetchJson(url);

              if (Array.isArray(deals) && deals.length > 0) {
                for (const d of deals) {
                  const dealAppId = parseInt(d.steamAppID, 10);
                  if (!dealAppId || !appIds.includes(dealAppId)) continue;

                  const offer = this.parseOfferFromDeal(d);
                  const existing = resultMap.get(dealAppId) || [];
                  existing.push(offer);
                  resultMap.set(dealAppId, existing);
                }

                if (deals.length >= 60) {
                  pageNumber++;
                } else {
                  hasMorePages = false;
                }
              } else {
                hasMorePages = false;
              }
            }
          });
          batchSucceeded = true;
        } catch (err: any) {
          const isRateLimit = err?.status === 429 || err?.message?.includes('429');
          if (attempt === 0 && isRateLimit) {
            // Queue has entered BACKOFF cooldown. Re-enqueuing will pause until cooldown clears.
            continue;
          }
          failedChunks++;
          logWarn(`CheapShark chunk failure: ${err?.message || 'Unknown error'}`, {
            chunkIndex,
            appIds: appIds.length,
            message: err?.message,
            status: err?.status
          });
          break;
        }
      }

      processed += chunk.length;
      if (onProgress) {
        onProgress(Math.min(processed, games.length), games.length, `CheapShark: ${Math.min(processed, games.length)}/${games.length} games checked...`);
      }
    }

    if (totalChunks > 0 && failedChunks === totalChunks) {
      const aggError: any = new Error(`All ${totalChunks} CheapShark chunks failed during batch fetch.`);
      aggError.requestCount = totalRequestsMade;
      throw aggError;
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
            const dealAppId = parseInt(d.steamAppID, 10);
            if (dealAppId && dealAppId !== steamAppId) continue;
            offers.push(this.parseOfferFromDeal(d));
          }

          const metaOffer = offers.find(o => o.metacriticScore !== undefined && o.metacriticScore > 0);
          if (metaOffer?.metacriticScore) {
            const game = gameRepo.getBySteamAppId(steamAppId);
            if (game && (!game.metacriticScore || (!game.metacriticUrl && metaOffer.metacriticUrl))) {
              gameRepo.updateMetadata(steamAppId, {
                metacriticScore: game.metacriticScore ?? metaOffer.metacriticScore,
                metacriticUrl: game.metacriticUrl ?? metaOffer.metacriticUrl
              });
            }
          }
        }
      } catch (err: any) {
        if (err?.status === 404) return [];
        throw err;
      }

      // Check historical low in a resilient sub-block so a title lookup error does not discard active offers
      try {
        if (gameTitle && gameTitle.trim()) {
          const gamesUrl = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(gameTitle.trim())}&limit=1`;
          const gameResults: any = await safeFetchJson(gamesUrl);
          if (Array.isArray(gameResults) && gameResults.length > 0 && gameResults[0].cheapestPriceEver) {
            if (Number(gameResults[0].steamAppID) === steamAppId) {
              const cpe = gameResults[0].cheapestPriceEver;
              const histEur = convertToEur(parseFloat(cpe.price), 'USD');
              const histDate = cpe.date ? new Date(cpe.date * 1000).toISOString() : new Date().toISOString();
              
              const game = gameRepo.getBySteamAppId(steamAppId);
              if (game) {
                gameRepo.updateHistoricalLow(game.id, histEur, histDate, 'CheapShark');
              }
            }
          }
        }
      } catch {
        // Suppress non-critical historical low lookup failure
      }

      return offers;
    });
  }
}

export const cheapsharkAdapter = new CheapSharkSourceAdapter();
