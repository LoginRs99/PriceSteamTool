import { config } from '../config/index.js';
import { type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';

export class GoCDKeysSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'gocdkeys' as const;
  public readonly name = 'GoCDKeys';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('gocdkeys', config.delays.gocdkeys, 500);

  public isEnabled(): boolean {
    // Disabled by default to avoid aggressive scraping; opt-in via sources setting
    return false;
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    return this.queue.enqueue(async () => {
      // Conservative query
      try {
        const searchUrl = `https://gocdkeys.com/api/search?q=${encodeURIComponent(gameTitle)}`;
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
            'Accept': 'application/json, text/plain, */*'
          }
        });

        if (response.status === 403 || response.status === 429) {
          const err: any = new Error(`GoCDKeys challenge (${response.status})`);
          err.status = response.status;
          throw err;
        }

        if (!response.ok) return [];
        const data: any = await response.json();
        if (Array.isArray(data) && data.length > 0 && data[0].price) {
          const priceEur = parseFloat(data[0].price);
          if (!isNaN(priceEur) && priceEur > 0) {
            return [{
              merchantCode: 'gocdkeys_best',
              merchantName: 'GoCDKeys Best',
              isOfficial: false,
              productTypeRaw: 'STEAM_KEY',
              regionRaw: 'GLOBAL',
              priceEur,
              dealUrl: data[0].url || 'https://gocdkeys.com',
              rawPayload: data[0]
            }];
          }
        }
      } catch (err: any) {
        if (err?.status === 403 || err?.status === 429) {
          throw err;
        }
      }
      return [];
    });
  }
}

export const gocdkeysAdapter = new GoCDKeysSourceAdapter();
