import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { circuitBreakers } from '../sync/circuitBreaker.js';
import { normalizeRegion } from '../domain/normalizer.js';
import { isKeyshopSourceStr } from '../domain/priceIntelligence/types.js';
import { gameRepo } from '../db/index.js';
import { logInfo, logWarn } from '../utils/logger.js';

interface NexardaFindResponse {
  success: boolean;
  code: string; // 'game_found' | 'game_not_found'
  message?: string;
  game?: {
    id: number;
    name: string;
  };
}

interface NexardaSearchResponse {
  success: boolean;
  code: string;
  message?: string;
  results?: {
    page?: number;
    pages?: number;
    shown?: number;
    total?: number;
    items?: Array<{
      type: string;
      title: string;
      slug?: string;
      game_info?: {
        id: number;
        name: string;
        release_date?: number;
      };
    }>;
  };
}

interface NexardaCoupon {
  available: boolean;
  discount: number;
  code: string;
  price_without: number;
  terms?: string;
}

interface NexardaPriceOffer {
  url: string;
  store: {
    name: string;
    image?: string;
    type: 'Official Store' | 'Key Seller' | 'Marketplace' | string;
    official: boolean;
  };
  edition: string;
  edition_full?: string;
  region: string;
  platform: string;
  available: boolean;
  price: number; // In EUR (or requested currency); -1 = out of stock, -99 = unavailable
  discount?: number;
  coupon?: NexardaCoupon;
}

interface NexardaPricesResponse {
  success: boolean;
  code: string; // 'game_prices_found'
  message?: string;
  info?: {
    id: number;
    name: string;
    slug?: string;
  };
  prices?: {
    currency: string;
    currency_symbol?: string;
    lowest?: number;
    highest?: number;
    stores?: number;
    offers?: number;
    list?: NexardaPriceOffer[];
  };
}

export class NexardaSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'nexarda' as const;
  public readonly name = 'NEXARDA';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('nexarda', config.delays.nexarda || 500, 100);
  private idCache = new Map<number, number>(); // steamAppId -> nexardaId

  public clearQueue(): void {
    this.queue.reset();
  }

  public clearCache(): void {
    this.idCache.clear();
  }

  public isEnabled(): boolean {
    return Boolean(config.nexardaEnabled);
  }

  private getRequestHeaders(): Record<string, string> {
    return {
      'Accept': 'application/json',
      'User-Agent': 'PriceSteamTool/2.8 (+https://github.com/pricesteamtool)'
    };
  }

  /**
   * Resolves a Steam App ID to a NEXARDA numeric product ID.
   * 1. Checks in-memory cache.
   * 2. Checks database games.nexarda_id.
   * 3. Queries /api/v3/find?steam=...
   * 4. Fallback search /api/v3/search?type=games&q=...
   */
  public async resolveNexardaId(steamAppId: number, gameTitle?: string): Promise<number | null> {
    if (this.idCache.has(steamAppId)) {
      return this.idCache.get(steamAppId)!;
    }

    const existingGame = gameRepo.getBySteamAppId(steamAppId);
    if (existingGame?.nexardaId) {
      this.idCache.set(steamAppId, existingGame.nexardaId);
      return existingGame.nexardaId;
    }

    // Attempt direct Steam ID resolution
    try {
      const findUrl = `https://www.nexarda.com/api/v3/find?steam=${steamAppId}&output=json`;
      const findRes = await safeFetchJson<NexardaFindResponse>(findUrl, {
        headers: this.getRequestHeaders()
      }, 8000);

      if (findRes?.success && findRes.game?.id) {
        const nid = Number(findRes.game.id);
        this.idCache.set(steamAppId, nid);
        gameRepo.updateNexardaId(steamAppId, nid);
        return nid;
      }
    } catch (err: any) {
      logWarn(`[NEXARDA] Direct Steam find failed for ${steamAppId}: ${err.message}`);
    }

    // Fallback: title search if gameTitle provided
    if (gameTitle?.trim()) {
      try {
        const cleanTitle = gameTitle.replace(/[\u2122\u00ae]/g, '').trim();
        const searchUrl = `https://www.nexarda.com/api/v3/search?type=games&q=${encodeURIComponent(cleanTitle)}`;
        const searchRes = await safeFetchJson<NexardaSearchResponse>(searchUrl, {
          headers: this.getRequestHeaders()
        }, 8000);

        const items = searchRes?.results?.items;
        if (Array.isArray(items) && items.length > 0) {
          const first = items[0];
          if (first?.game_info?.id) {
            const nid = Number(first.game_info.id);
            this.idCache.set(steamAppId, nid);
            gameRepo.updateNexardaId(steamAppId, nid);
            return nid;
          }
        }
      } catch (err: any) {
        logWarn(`[NEXARDA] Search fallback failed for "${gameTitle}": ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Normalizes a NEXARDA price item into PriceSteamTool's NormalizedSourceOffer
   */
  private normalizeOffer(item: NexardaPriceOffer, fallbackUrl: string): NormalizedSourceOffer | null {
    // Only accept active, in-stock Steam PC offers
    if (!item.available || item.price <= 0.05) {
      return null;
    }

    // Platform filtering: Steam keys or PC compatible
    const platform = (item.platform || '').toLowerCase();
    if (!platform.includes('steam') && !platform.includes('pc') && !platform.includes('windows')) {
      return null;
    }

    const merchantCode = item.store.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');

    const normRegion = normalizeRegion(item.region || 'Global');
    if (!normRegion.isValid) {
      return null;
    }

    // NEXARDA's item.price is the final net price (coupon discount already deducted)
    const priceEur = item.price;
    const rawOriginalPrice = (item.coupon?.available && item.coupon.price_without > item.price)
      ? item.coupon.price_without
      : undefined;

    const isKnownKeyshop = isKeyshopSourceStr(item.store.name) || isKeyshopSourceStr(merchantCode);
    const isOfficial = !isKnownKeyshop && Boolean(item.store.official);

    return {
      merchantCode: merchantCode || 'nexarda-store',
      merchantName: item.store.name,
      isOfficial,
      priceEur,
      originalPriceEur: rawOriginalPrice,
      rawPrice: item.price,
      rawCurrency: 'EUR',
      rawOriginalPrice,
      voucherCode: item.coupon?.available && item.coupon.code ? item.coupon.code : undefined,
      dealUrl: item.url || fallbackUrl,
      productTypeRaw: 'STEAM_KEY',
      regionRaw: normRegion.regionCode,
      editionName: item.edition || undefined,
      rawPayload: item
    };
  }

  /**
   * Fetch prices for a single game
   */
  public async fetchPricesForGame(
    steamAppId: number,
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const cbCheck = circuitBreakers.canExecute('nexarda');
    if (!cbCheck.allowed) {
      logWarn(`[NEXARDA] Circuit open/cooling down, skipping lookup for "${gameTitle}" (${steamAppId}).`);
      return [];
    }

    return this.queue.enqueue(async () => {
      try {
        const nexardaId = await this.resolveNexardaId(steamAppId, gameTitle);
        if (!nexardaId) {
          return [];
        }

        const pricesUrl = `https://www.nexarda.com/api/v3/prices?type=game&id=${nexardaId}&currency=EUR`;
        const res = await safeFetchJson<NexardaPricesResponse>(pricesUrl, {
          headers: this.getRequestHeaders()
        }, 10000);

        circuitBreakers.recordSuccess('nexarda');

        const offersList = res?.prices?.list;
        if (!Array.isArray(offersList) || offersList.length === 0) {
          return [];
        }

        const offers: NormalizedSourceOffer[] = [];
        const fallbackUrl = `https://www.nexarda.com/games/${res.info?.slug || nexardaId}`;

        for (const rawItem of offersList) {
          const norm = this.normalizeOffer(rawItem, fallbackUrl);
          if (norm) {
            offers.push(norm);
          }
        }

        return offers;
      } catch (err: any) {
        if (err?.status === 429 || err?.retryAfterSec) {
          circuitBreakers.recordRateLimit('nexarda', err.retryAfterSec || 30);
        } else {
          circuitBreakers.recordFailure('nexarda', err.message);
        }
        logWarn(`[NEXARDA] Price lookup failed for "${gameTitle}" (${steamAppId}): ${err.message}`);
        return [];
      }
    });
  }

  /**
   * Batch lookup: iterates games with paced queue and reports progress
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();

    if (!this.isEnabled() || games.length === 0) {
      return resultMap;
    }

    const validGames = games.filter(g => g.steamAppId && !isNaN(g.steamAppId));
    let failedGames = 0;

    for (let i = 0; i < validGames.length; i++) {
      const g = validGames[i];

      if (circuitBreakers.isCoolingDown('nexarda')) {
        const remainingSec = circuitBreakers.getRemainingCooldownSec('nexarda');
        if (remainingSec <= 15 && process.env.NODE_ENV !== 'test') {
          logWarn(`[NEXARDA] Cooldown active (${remainingSec}s remaining). Waiting for reset...`);
          await new Promise(r => setTimeout(r, (remainingSec + 1) * 1000));
        } else {
          logWarn(`[NEXARDA] Skipping game "${g.title}" (${g.steamAppId}) due to active cooldown (${remainingSec}s remaining).`);
          failedGames++;
          if (onProgress && (i % 5 === 0 || i === validGames.length - 1)) {
            onProgress(
              i + 1,
              validGames.length,
              `NEXARDA: [${i + 1}/${validGames.length}] (cooldown active)...`
            );
          }
          continue;
        }
      }

      const offers = await this.fetchPricesForGame(g.steamAppId, g.title);
      if (offers.length > 0) {
        resultMap.set(g.steamAppId, offers);
      }

      if (onProgress && (i % 5 === 0 || i === validGames.length - 1)) {
        onProgress(
          i + 1,
          validGames.length,
          `NEXARDA: [${i + 1}/${validGames.length}] ${g.title}`
        );
      }
    }

    (resultMap as any).failedGames = failedGames;
    return resultMap;
  }
}

export const nexardaAdapter = new NexardaSourceAdapter();
