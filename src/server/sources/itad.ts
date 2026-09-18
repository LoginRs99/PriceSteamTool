import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { gameRepo } from '../db/index.js';
import { convertToEur } from '../domain/normalizer.js';
import { logWarn } from '../utils/logger.js';

export const KNOWN_STEAM_KEY_SHOPS = [
  'humble', 'fanatical', 'green man gaming', 'greenmangaming', 'gamebillet',
  'indiegala', 'wingamestore', 'gamersgate', 'gamesplanet', 'dlgamer',
  'joybuggy', 'dreamgame', '2game', 'voidu', 'planet_cool', 'noctre',
  'macgamestore', 'gamesload', 'yuplay', 'gameship', 'buka', 'nuuvem'
];

export const KNOWN_NON_STEAM_SHOPS = [
  'epic', 'gog', 'ubisoft', 'ea app', 'origin', 'battle.net', 'blizzard',
  'microsoft', 'xbox', 'rockstar', 'itch.io', 'playstation', 'nintendo'
];

export function parseItadProductAndOfficial(shopName: string = '', drms: string[] = []): { productTypeRaw: string; isOfficial: boolean } {
  const sLower = (shopName || '').toLowerCase();
  const isDirectSteam = sLower.includes('steam store') || sLower === 'steam';
  const hasSteamDrm = drms.some((d: string) => d.toLowerCase().includes('steam'));
  const isKnownSteamShop = KNOWN_STEAM_KEY_SHOPS.some(k => sLower.includes(k));
  const isKnownNonSteamShop = KNOWN_NON_STEAM_SHOPS.some(k => sLower.includes(k));

  if (isDirectSteam) {
    return { productTypeRaw: 'Direct Purchase', isOfficial: true };
  }

  // Proprietary non-Steam launcher stores (Epic Games Store, GOG, Ubisoft, EA App, Origin, Battle.net, etc.) NEVER sell Steam keys
  if (isKnownNonSteamShop) {
    return { productTypeRaw: `${shopName} (Non-Steam)`, isOfficial: false };
  }

  if (hasSteamDrm) {
    return { productTypeRaw: 'Steam Key', isOfficial: true };
  }

  if (drms.length > 0 && !hasSteamDrm) {
    return { productTypeRaw: `${drms.join(', ')} (Non-Steam)`, isOfficial: false };
  }

  if (isKnownSteamShop) {
    return { productTypeRaw: 'Steam Key', isOfficial: true };
  }

  // Unverified/unknown shop without explicit Steam DRM
  return { productTypeRaw: 'Unknown/Non-Steam', isOfficial: false };
}

export const ITAD_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidItadUuid(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return ITAD_UUID_REGEX.test(id.trim());
}

export function normalizeItadCountry(country?: string | null, fallback?: string): string {
  const defaultFallback = (fallback && fallback.length === 2 && fallback.toUpperCase() !== 'EU')
    ? fallback.toUpperCase()
    : (config.preferredCountry && config.preferredCountry.length === 2 && config.preferredCountry.toUpperCase() !== 'EU'
        ? config.preferredCountry.toUpperCase()
        : 'US');

  if (!country || typeof country !== 'string') return defaultFallback;
  const upper = country.trim().toUpperCase();
  // UK is common vernacular for United Kingdom, but ISO 3166-1 alpha-2 is GB
  if (upper === 'UK') return 'GB';
  // ITAD strictly requires an ISO 3166-1 alpha-2 country code. 'EU' is rejected with HTTP 400.
  if (upper === 'EU' || !/^[A-Z]{2}$/.test(upper)) {
    return defaultFallback;
  }
  return upper;
}

export function formatItadSinceTimestamp(sinceIso?: string): string {
  let d: Date;
  if (sinceIso) {
    d = new Date(sinceIso);
  } else {
    d = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 * 2);
  }
  const validDate = isNaN(d.getTime()) ? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 * 2) : d;
  // ITAD v2 strictly forbids fractional seconds (.sssZ) in ISO timestamps
  return validDate.toISOString().replace(/\.\d+Z$/, 'Z');
}

export interface ItadHistoricalPoint {
  shopName: string;
  priceEur: number;
  rawPrice: number;
  rawCurrency: string;
  regularPriceEur?: number;
  discountPercent: number;
  timestamp: string;
}

export class ItadSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'itad' as const;
  public readonly name = 'IsThereAnyDeal';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('itad', config.delays.itad, 200);

  public isEnabled(): boolean {
    // Enabled by default; if API key is present, it uses official API, otherwise falls back gracefully
    return true;
  }

  public clearQueue(): void {
    this.queue.clear();
  }

  /**
   * Looks up ITAD UUID for a Steam AppID
   */
  public async lookupItadId(steamAppId: number): Promise<string | null> {
    if (!config.itadApiKey || !steamAppId || isNaN(steamAppId) || steamAppId <= 0) return null;

    return this.queue.enqueue(async () => {
      try {
        const url = `https://api.isthereanydeal.com/games/lookup/v1?key=${config.itadApiKey}&appid=${steamAppId}`;
        const data: any = await safeFetchJson(url);
        if (data?.game?.id && isValidItadUuid(data.game.id)) {
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
   * Fetches historical price cuts from ITAD v2 history endpoint
   */
  public async fetchPriceHistory(
    steamAppId: number, 
    itadId?: string,
    sinceIso?: string
  ): Promise<ItadHistoricalPoint[]> {
    if (!config.itadApiKey) return [];

    let resolvedItadId = itadId;
    if (!resolvedItadId) {
      resolvedItadId = (await this.lookupItadId(steamAppId)) || undefined;
    }

    if (!resolvedItadId || typeof resolvedItadId !== 'string' || !resolvedItadId.trim()) return [];

    return this.queue.enqueue(async () => {
      const country = normalizeItadCountry(config.preferredCountry);
      const since = formatItadSinceTimestamp(sinceIso);
      const url = `https://api.isthereanydeal.com/games/history/v2?key=${config.itadApiKey}&id=${resolvedItadId}&country=${country}&since=${encodeURIComponent(since)}`;

      try {
        const response: any = await safeFetchJson(url);
        if (!Array.isArray(response)) {
          return [];
        }

        const results: ItadHistoricalPoint[] = [];

        for (const item of response) {
          if (!item || !item.deal || item.deal.price?.amount === undefined) continue;
          const rawAmount = Number(item.deal.price.amount);
          if (isNaN(rawAmount) || rawAmount < 0) continue;

          const currency = item.deal.price.currency || 'EUR';
          const priceEur = convertToEur(rawAmount, currency);
          const rawRegular = item.deal.regular?.amount !== undefined ? Number(item.deal.regular.amount) : undefined;
          const regularPriceEur = rawRegular !== undefined ? convertToEur(rawRegular, item.deal.regular?.currency || currency) : undefined;
          const discountPercent = typeof item.deal.cut === 'number' ? Math.round(item.deal.cut) : 0;
          const shopName = item.shop?.name || 'Store';
          const timestamp = item.timestamp || new Date().toISOString();

          results.push({
            shopName,
            priceEur,
            rawPrice: rawAmount,
            rawCurrency: currency,
            regularPriceEur,
            discountPercent,
            timestamp
          });
        }

        return results;
      } catch (err: any) {
        if (err.status === 404) return [];
        throw err;
      }
    });
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
    let failedChunks = 0;
    let totalChunks = 0;
    for (let i = 0; i < itadIdsToFetch.length; i += chunkSize) {
      totalChunks++;
      const chunk = itadIdsToFetch.slice(i, i + chunkSize);
      try {
        const chunkResults = await this.fetchBatchOverview(chunk, itadIdToAppId);
        for (const [appId, offers] of chunkResults.entries()) {
          resultMap.set(appId, offers);
        }
      } catch (err: any) {
        failedChunks++;
        logWarn(`ITAD batch chunk [${i}-${i + chunk.length}] failed: ${err?.message || 'Unknown error'}`, {
          chunkIndex: Math.floor(i / chunkSize),
          chunkSize: chunk.length,
          error: err?.message,
          status: err?.status
        });
      }
    }

    if (totalChunks > 0 && failedChunks === totalChunks) {
      const aggError: any = new Error(`All ${totalChunks} ITAD chunks failed during batch fetch.`);
      throw aggError;
    }

    (resultMap as any).failedChunks = failedChunks;
    (resultMap as any).totalChunks = totalChunks;

    return resultMap;
  }

  private async fetchBatchOverview(
    itadIds: string[], 
    itadIdToAppId: Map<string, number>
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    return this.queue.enqueue(async () => {
      const resultMap = new Map<number, NormalizedSourceOffer[]>();
      const validIds = itadIds.filter(id => id && typeof id === 'string' && id.trim().length > 0);
      if (validIds.length === 0) return resultMap;

      const country = normalizeItadCountry(config.preferredCountry);
      const url = `https://api.isthereanydeal.com/games/overview/v2?key=${config.itadApiKey}&country=${country}`;
      
      const response: any = await safeFetchJson(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(validIds)
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
          
          const { productTypeRaw, isOfficial } = parseItadProductAndOfficial(shopName, drms);

          offers.push({
            merchantCode: shopCode,
            merchantName: shopName,
            isOfficial,
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
