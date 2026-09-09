import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { convertToEur } from '../domain/normalizer.js';
import { exchangeRateService } from '../domain/exchangeRate.js';
import { calculateSteamDbRating } from '../domain/rating.js';

export interface SteamWishlistItem {
  steamAppId: number;
  title: string;
  priority: number;
  dateAdded?: string;
  headerImage?: string;
  capsuleImage?: string;
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
  rawPrice?: number;
  rawCurrency?: string;
  rawOriginalPrice?: number;
  basePriceEur?: number;
  currentPriceEur?: number;
  discountPercent: number;
  reviewDesc?: string;
  reviewsPercent?: number;
  reviewsTotal?: string;
  steamdbRating?: number;
  metacriticScore?: number;
  metacriticUrl?: string;
}

export interface SteamAppDetails {
  steamAppId: number;
  title: string;
  headerImage?: string;
  capsuleImage?: string;
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
  rawPrice?: number;
  rawCurrency?: string;
  rawOriginalPrice?: number;
  basePriceEur?: number;
  currentPriceEur?: number;
  discountPercent: number;
  metacriticScore?: number;
  metacriticUrl?: string;
}

const STEAM_STORE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9,hu;q=0.8',
  'Cookie': 'birthtime=283993201; mature_content=1; wants_mature_content=1; lastagecheckage=1-0-1990;',
  'Referer': 'https://store.steampowered.com/'
};

export class SteamSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'steam' as const;
  public readonly name = 'Steam Storefront';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('steam', config.delays.steam, 100);

  public isEnabled(): boolean {
    return true;
  }

  /**
   * Resolves steam ID (either already a 64-bit ID or custom vanity URL / profile link)
   */
  public async resolveSteamId64(input: string): Promise<{ steamId64: string; avatarUrl?: string; personaName?: string }> {
    const clean = input.trim();
    if (/^\d{17}$/.test(clean)) {
      return { steamId64: clean };
    }

    let vanitySlug = clean;
    const profileMatch = clean.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
    if (profileMatch) {
      return { steamId64: profileMatch[1] };
    }

    const idMatch = clean.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
    if (idMatch) {
      vanitySlug = idMatch[1];
    }

    const apiKey = config.steamApiKey;
    if (apiKey) {
      try {
        const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(vanitySlug)}`;
        const res: any = await safeFetchJson(url);
        if (res?.response?.success === 1 && res.response.steamid) {
          return { steamId64: res.response.steamid };
        }
      } catch {
        // Fall back to direct XML profile fetch
      }
    }

    try {
      const xmlUrl = `https://steamcommunity.com/id/${encodeURIComponent(vanitySlug)}/?xml=1`;
      const response = await fetch(xmlUrl, {
        headers: { 'User-Agent': STEAM_STORE_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        const text = await response.text();
        const steamIdMatch = text.match(/<steamID64>(\d+)<\/steamID64>/);
        const personaMatch = text.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
        const avatarMatch = text.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/);

        if (steamIdMatch && steamIdMatch[1]) {
          return {
            steamId64: steamIdMatch[1],
            personaName: personaMatch ? personaMatch[1] : undefined,
            avatarUrl: avatarMatch ? avatarMatch[1] : undefined
          };
        }
      }
    } catch {
      // Fallback
    }

    return { steamId64: vanitySlug };
  }

  /**
   * Fetches user wishlist items with full metadata using paginated wishlistdata endpoint
   */
  public async fetchWishlist(steamId64: string): Promise<SteamWishlistItem[]> {
    return this.queue.enqueue(async () => {
      const items: SteamWishlistItem[] = [];
      const seenAppIds = new Set<number>();
      let page = 0;
      const maxPages = 60; // Safety cap (up to ~6,000 games)

      const targetPath = /^\d+$/.test(steamId64) ? `profiles/${steamId64}` : `id/${steamId64}`;

      let requestsMade = 0;

      // 1. Primary Strategy: Paginated wishlistdata (gives full metadata and store prices in batch)
      try {
        while (page < maxPages) {
          if (page > 0) {
            // Polite pacing between Steam Storefront wishlist pages (1.5s)
            await new Promise(r => setTimeout(r, Math.max(1500, config.delays.steam)));
          }
          const url = `https://store.steampowered.com/wishlist/${targetPath}/wishlistdata/?p=${page}`;
          let data: any = null;
          try {
            requestsMade++;
            data = await safeFetchJson(url, { headers: STEAM_STORE_HEADERS });
          } catch (fetchErr: any) {
            if (fetchErr?.status === 429) {
              const backoffSec = fetchErr.retryAfterSec ?? 30;
              const backoffMs = Math.max(backoffSec * 1000, 5000);
              await new Promise(r => setTimeout(r, backoffMs));
              try {
                requestsMade++;
                data = await safeFetchJson(url, { headers: STEAM_STORE_HEADERS });
              } catch (retryErr: any) {
                const err: any = new Error(`Steam wishlist pagination failed on page ${page}: ${retryErr?.message || 'Rate limit 429'}`);
                err.requestCount = requestsMade;
                err.status = retryErr?.status ?? 429;
                err.retryAfterSec = retryErr?.retryAfterSec;
                throw err;
              }
            } else {
              const err: any = new Error(`Steam wishlist pagination failed on page ${page}: ${fetchErr?.message || 'Network error'}`);
              err.requestCount = requestsMade;
              err.status = fetchErr?.status;
              throw err;
            }
          }

          if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
            break; // Valid end of wishlist reached
          }

          let pageItemsAdded = 0;
          for (const [appIdStr, info] of Object.entries(data)) {
            const appId = parseInt(appIdStr, 10);
            if (isNaN(appId) || seenAppIds.has(appId) || !info || typeof info !== 'object') continue;

            seenAppIds.add(appId);
            pageItemsAdded++;

            const infoObj = info as any;
            const isFree = Boolean(infoObj.free);
            const title = infoObj.name || `App ${appId}`;
            const headerImage = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
            const capsuleImage = infoObj.caps || `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`;
            const priority = Number(infoObj.priority ?? 0);
            const dateAdded = infoObj.added ? new Date(infoObj.added * 1000).toISOString() : undefined;
            const releaseDate = infoObj.release_date || undefined;
            const isDlc = infoObj.is_type === 'dlc' || infoObj.type === 'dlc';

            // Price extraction from subs if present (prices in Steam API are integer cents)
            let basePriceEur: number | undefined = undefined;
            let currentPriceEur: number | undefined = undefined;
            let rawPrice: number | undefined = undefined;
            let rawCurrency = 'EUR';
            let rawOriginalPrice: number | undefined = undefined;
            let discountPercent = 0;

            if (isFree) {
              basePriceEur = 0;
              currentPriceEur = 0;
              rawPrice = 0;
              rawOriginalPrice = 0;
            } else if (Array.isArray(infoObj.subs) && infoObj.subs.length > 0) {
              const sub = infoObj.subs[0];
              if (sub.price !== undefined && sub.price !== null) {
                const subPriceCents = Number(sub.price);
                rawPrice = subPriceCents / 100;
                discountPercent = Number(sub.discount_pct || 0);

                if (sub.currency) {
                  rawCurrency = exchangeRateService.normalizeCurrencyCode(sub.currency);
                }

                if (discountPercent > 0 && rawPrice > 0) {
                  rawOriginalPrice = Math.round((rawPrice / (1 - (discountPercent / 100))) * 100) / 100;
                } else {
                  rawOriginalPrice = rawPrice;
                }

                currentPriceEur = convertToEur(rawPrice, rawCurrency);
                basePriceEur = rawOriginalPrice !== undefined ? convertToEur(rawOriginalPrice, rawCurrency) : currentPriceEur;
              }
            }

            const reviewDesc = infoObj.review_desc || undefined;
            const reviewsPercent = (infoObj.reviews_percent !== undefined && infoObj.reviews_percent !== null)
              ? Number(infoObj.reviews_percent)
              : undefined;
            const reviewsTotal = (infoObj.reviews_total !== undefined && infoObj.reviews_total !== null)
              ? String(infoObj.reviews_total)
              : undefined;
            const steamdbRating = calculateSteamDbRating(reviewsPercent, reviewsTotal);
            const metacriticScore = (infoObj.metacritic_score !== undefined && infoObj.metacritic_score !== null)
              ? Number(infoObj.metacritic_score)
              : (infoObj.metacritic?.score !== undefined && infoObj.metacritic?.score !== null ? Number(infoObj.metacritic.score) : undefined);
            const metacriticUrl = infoObj.metacritic?.url || infoObj.metacritic_url || undefined;

            items.push({
              steamAppId: appId,
              title,
              priority,
              dateAdded,
              headerImage,
              capsuleImage,
              releaseDate,
              isDlc,
              isFree,
              rawPrice,
              rawCurrency,
              rawOriginalPrice,
              basePriceEur,
              currentPriceEur,
              discountPercent,
              reviewDesc,
              reviewsPercent,
              reviewsTotal,
              steamdbRating,
              metacriticScore,
              metacriticUrl
            });
          }

          if (pageItemsAdded === 0) {
            break;
          }
          page++;
        }

        (items as any).requestCount = Math.max(1, requestsMade);
        (items as any).pageCount = Math.max(1, requestsMade);
        return items;
      } catch (err) {
        // Fall back to IWishlistService if wishlistdata was blocked or failed
      }

      // 2. Fallback: IWishlistService Web API
      try {
        requestsMade++;
        const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId64}`;
        const data: any = await safeFetchJson(url);
        
        if (data?.response?.items && Array.isArray(data.response.items)) {
          const resultItems = data.response.items.map((item: any) => ({
            steamAppId: Number(item.appid),
            title: `App ${item.appid}`,
            priority: Number(item.priority ?? 0),
            dateAdded: item.date_added ? new Date(item.date_added * 1000).toISOString() : undefined,
            headerImage: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${item.appid}/header.jpg`,
            capsuleImage: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${item.appid}/capsule_231x87.jpg`,
            isDlc: false,
            isFree: false,
            discountPercent: 0
          }));
          (resultItems as any).requestCount = Math.max(1, requestsMade);
          (resultItems as any).pageCount = Math.max(1, requestsMade);
          return resultItems;
        }
      } catch (e) {
        const err: any = new Error(`Failed to fetch Steam Wishlist for ${steamId64}. Ensure the Steam profile & wishlist are set to Public.`);
        err.requestCount = requestsMade;
        throw err;
      }

      (items as any).requestCount = Math.max(1, requestsMade);
      (items as any).pageCount = Math.max(1, requestsMade);
      return items;
    });
  }

  /**
   * Fetches game metadata & current Steam price for an individual AppID
   */
  public async fetchAppDetails(steamAppId: number): Promise<SteamAppDetails | null> {
    return this.queue.enqueue(async () => {
      const url = `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&cc=${config.preferredCountry.toLowerCase()}&filters=basic,price_overview,metacritic`;
      const data: any = await safeFetchJson(url, { headers: STEAM_STORE_HEADERS });

      const entry = data?.[String(steamAppId)];
      if (!entry?.success || !entry?.data) return null;

      const g = entry.data;
      const priceOverview = g.price_overview;
      const isFree = Boolean(g.is_free);
      
      let basePriceEur: number | undefined = undefined;
      let currentPriceEur: number | undefined = undefined;
      let rawPrice: number | undefined = undefined;
      let rawCurrency = 'EUR';
      let rawOriginalPrice: number | undefined = undefined;
      let discountPercent = 0;

      if (priceOverview) {
        if (priceOverview.currency) {
          rawCurrency = exchangeRateService.normalizeCurrencyCode(priceOverview.currency);
        }

        // Price in Steam API is in cents (e.g. 1999 -> 19.99)
        rawOriginalPrice = priceOverview.initial ? priceOverview.initial / 100 : undefined;
        rawPrice = priceOverview.final ? priceOverview.final / 100 : rawOriginalPrice;
        discountPercent = priceOverview.discount_percent || 0;

        if (rawPrice !== undefined) {
          currentPriceEur = convertToEur(rawPrice, rawCurrency);
        }
        if (rawOriginalPrice !== undefined) {
          basePriceEur = convertToEur(rawOriginalPrice, rawCurrency);
        } else {
          basePriceEur = currentPriceEur;
        }
      } else if (isFree) {
        rawPrice = 0;
        rawOriginalPrice = 0;
        basePriceEur = 0;
        currentPriceEur = 0;
      }

      const metacriticScore = (g.metacritic?.score !== undefined && g.metacritic?.score !== null)
        ? Number(g.metacritic.score)
        : undefined;
      const metacriticUrl = g.metacritic?.url || undefined;

      return {
        steamAppId,
        title: g.name || `App ${steamAppId}`,
        headerImage: g.header_image || `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`,
        capsuleImage: g.capsule_image || `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/capsule_231x87.jpg`,
        releaseDate: g.release_date?.date || undefined,
        isDlc: g.type === 'dlc',
        isFree,
        rawPrice,
        rawCurrency,
        rawOriginalPrice,
        basePriceEur,
        currentPriceEur,
        discountPercent,
        metacriticScore,
        metacriticUrl
      };
    });
  }

  /**
   * Fetches owned games (app IDs) for a Steam profile.
   * Tries Steam Web API (IPlayerService/GetOwnedGames) if key is configured,
   * otherwise falls back to public Steam Community XML endpoint.
   */
  public async fetchOwnedGames(steamId64OrSlug: string): Promise<number[]> {
    return this.queue.enqueue(async () => {
      const resolved = await this.resolveSteamId64(steamId64OrSlug);
      const targetId = resolved.steamId64 || steamId64OrSlug;
      const appIds = new Set<number>();

      // 1. Steam Web API (Fastest and officially supported if key is configured)
      if (config.steamApiKey && /^\d{17}$/.test(targetId)) {
        try {
          const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${config.steamApiKey}&steamid=${targetId}&format=json&include_appinfo=0`;
          const res: any = await safeFetchJson(url);
          if (res?.response?.games && Array.isArray(res.response.games)) {
            for (const g of res.response.games) {
              if (g?.appid && typeof g.appid === 'number') {
                appIds.add(g.appid);
              }
            }
            return Array.from(appIds);
          }
        } catch {
          // Fall back to community XML endpoint
        }
      }

      // 2. Steam Community XML /games?xml=1 fallback
      try {
        const targetPath = /^\d+$/.test(targetId) ? `profiles/${targetId}` : `id/${targetId}`;
        const xmlUrl = `https://steamcommunity.com/${targetPath}/games?xml=1`;
        const response = await fetch(xmlUrl, {
          headers: { 'User-Agent': STEAM_STORE_HEADERS['User-Agent'] },
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          const xmlText = await response.text();
          const regex = /<appID>(\d+)<\/appID>/g;
          let match;
          while ((match = regex.exec(xmlText)) !== null) {
            const id = parseInt(match[1], 10);
            if (!isNaN(id)) {
              appIds.add(id);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SteamSourceAdapter] Failed to fetch owned games for ${targetId} via XML:`, err.message);
      }

      return Array.from(appIds);
    });
  }

  /**
   * PriceSourceAdapter interface implementation: generates the official Steam Store offer
   */
  public async fetchPricesForGame(steamAppId: number): Promise<NormalizedSourceOffer[]> {
    const details = await this.fetchAppDetails(steamAppId);
    if (!details || details.currentPriceEur === undefined) return [];

    return [{
      merchantCode: 'steam',
      merchantName: 'Steam Store',
      isOfficial: true,
      productTypeRaw: 'DIRECT_PURCHASE',
      regionRaw: 'GLOBAL',
      priceEur: details.currentPriceEur,
      originalPriceEur: details.basePriceEur,
      rawPrice: details.rawPrice,
      rawCurrency: details.rawCurrency,
      rawOriginalPrice: details.rawOriginalPrice,
      dealUrl: `https://store.steampowered.com/app/${steamAppId}/`,
      rawPayload: details
    }];
  }
}

export const steamAdapter = new SteamSourceAdapter();

