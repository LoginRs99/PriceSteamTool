import { config } from '../config/index.js';
import { type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';

export class AllKeyShopSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'allkeyshop' as const;
  public readonly name = 'AllKeyShop';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('allkeyshop', config.delays.allkeyshop, 500);

  public isEnabled(): boolean {
    return true;
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    return this.queue.enqueue(async () => {
      // Respectful fallback: search lightweight public JSON endpoint if available
      try {
        const searchUrl = `https://www.allkeyshop.com/blog/wp-admin/admin-ajax.php?action=get_search_results&query=${encodeURIComponent(gameTitle)}`;
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
          }
        });

        if (response.status === 403 || response.status === 429) {
          const err: any = new Error(`AllKeyShop rate limit or challenge (${response.status})`);
          err.status = response.status;
          throw err;
        }

        if (!response.ok) return [];
        const data: any = await response.json();
        // Parse results if available
        if (data?.products && Array.isArray(data.products)) {
          const matched = data.products.find((p: any) => p.name?.toLowerCase().includes(gameTitle.toLowerCase()));
          if (matched && matched.price) {
            const priceEur = parseFloat(matched.price);
            if (!isNaN(priceEur) && priceEur > 0) {
              return [{
                merchantCode: 'allkeyshop_best',
                merchantName: 'AllKeyShop Best',
                isOfficial: false,
                productTypeRaw: 'STEAM_KEY',
                regionRaw: 'GLOBAL',
                priceEur,
                dealUrl: matched.url || 'https://www.allkeyshop.com',
                rawPayload: matched
              }];
            }
          }
        }
      } catch (err: any) {
        if (err?.status === 403 || err?.status === 429) {
          throw err; // Trigger circuit breaker
        }
      }
      return [];
    });
  }
}

export const allkeyshopAdapter = new AllKeyShopSourceAdapter();
