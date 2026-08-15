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
      const offers: NormalizedSourceOffer[] = [];
      try {
        // 1. High-fidelity VAKS v2 JSON API endpoint from AllKeyShop
        const vaksUrl = `https://www.allkeyshop.com/api/v2/vaks.php?action=products&currency=eur&name=${encodeURIComponent(gameTitle)}`;
        const response = await fetch(vaksUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
          }
        });

        if (response.status === 403 || response.status === 429) {
          const err: any = new Error(`AllKeyShop rate limit or challenge (${response.status})`);
          err.status = response.status;
          throw err;
        }

        if (response.ok) {
          const data: any = await response.json();
          const products = data?.products || data?.games;
          if (Array.isArray(products) && products.length > 0) {
            // Find closest match for game title
            const lowerTitle = gameTitle.toLowerCase();
            const matched = products.find((p: any) => p.name?.toLowerCase().includes(lowerTitle)) || products[0];

            if (matched) {
              const best = matched.bestOffer;
              const priceEur = best?.price ? Number(best.price) : (matched.offerAggregate?.lowestPrice ? Number(matched.offerAggregate.lowestPrice) : undefined);
              
              if (priceEur && priceEur > 0) {
                const storeName = best?.store?.name || 'AllKeyShop Best';
                const merchantCode = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '');
                const isOfficial = Boolean(best?.store?.isOfficialStore);
                const regionName = best?.region?.name || 'GLOBAL';
                const editionName = matched.edition || matched.name || best?.edition || '';
                const isNonSteam = ['gog', 'epic', 'origin', 'uplay', 'ubisoft', 'xbox', 'ps5', 'switch'].some(s => editionName.toLowerCase().includes(s) || storeName.toLowerCase().includes(s));
                const productTypeRaw = isNonSteam ? `${editionName || storeName} (Non-Steam)` : (editionName.toLowerCase().includes('gift') ? 'Steam Gift' : 'Steam Key');

                offers.push({
                  merchantCode,
                  merchantName: storeName,
                  isOfficial,
                  productTypeRaw,
                  regionRaw: regionName,
                  priceEur,
                  voucherCode: best?.bestVoucher?.code || undefined,
                  dealUrl: best?.url || matched.link || 'https://www.allkeyshop.com',
                  rawPayload: matched
                });
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.status === 403 || err?.status === 429) {
          throw err; // Trigger circuit breaker
        }
      }
      return offers;
    });
  }
}

export const allkeyshopAdapter = new AllKeyShopSourceAdapter();
