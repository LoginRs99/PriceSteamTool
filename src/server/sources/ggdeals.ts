import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { gameRepo } from '../db/index.js';

export class GGDealsSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'ggdeals' as const;
  public readonly name = 'GG.deals';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('ggdeals', config.delays.ggdeals, 250);

  public isEnabled(): boolean {
    return true;
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    return this.queue.enqueue(async () => {
      const offers: NormalizedSourceOffer[] = [];
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*'
      };

      if (config.ggdealsApiKey) {
        headers['X-Api-Key'] = config.ggdealsApiKey;
      }

      try {
        // Attempt official GG.deals API endpoint
        const url = `https://gg.deals/api/prices/?steam_app_id=${steamAppId}`;
        const data: any = await safeFetchJson(url, { headers });

        if (data?.deals && Array.isArray(data.deals)) {
          for (const deal of data.deals) {
            const isOfficial = deal.store_type === 'official' || Boolean(deal.is_official);
            const merchantName = deal.shop_name || deal.store_name || 'Store';
            const merchantCode = merchantName.toLowerCase().replace(/[^a-z0-9]+/g, '');

            offers.push({
              merchantCode,
              merchantName,
              isOfficial,
              productTypeRaw: deal.product_type || 'STEAM_KEY',
              regionRaw: deal.region || 'GLOBAL',
              priceEur: Number(deal.price_eur || deal.price || 0),
              originalPriceEur: deal.regular_price_eur ? Number(deal.regular_price_eur) : undefined,
              voucherCode: deal.coupon || deal.voucher || undefined,
              dealUrl: deal.url || `https://gg.deals/game/${deal.slug || ''}`,
              historicalLowEur: data.historical_low?.price_eur ? Number(data.historical_low.price_eur) : undefined,
              rawPayload: deal
            });
          }

          if (data.historical_low?.price_eur) {
            const game = gameRepo.getBySteamAppId(steamAppId);
            if (game) {
              gameRepo.updateHistoricalLow(
                game.id, 
                Number(data.historical_low.price_eur), 
                data.historical_low.date || new Date().toISOString(), 
                'GG.deals'
              );
            }
          }
        }
      } catch (err: any) {
        // Fallback or silent handling if API key is not configured yet
        if (err?.status === 404 || err?.status === 401) {
          // Game not found on GG.deals or auth required
          return [];
        }
        throw err;
      }

      return offers;
    });
  }
}

export const ggdealsAdapter = new GGDealsSourceAdapter();
