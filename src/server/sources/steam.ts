import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { convertToEur } from '../domain/normalizer.js';
import { exchangeRateService } from '../domain/exchangeRate.js';

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
}

export class SteamSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'steam' as const;
  public readonly name = 'Steam Storefront';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('steam', config.delays.steam, 100);

  public isEnabled(): boolean {
    return true;
  }

  /**
   * Resolves steam ID (either already a 64-bit ID or custom vanity URL)
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

    if (config.steamApiKey) {
      try {
        const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${config.steamApiKey}&vanityurl=${encodeURIComponent(vanitySlug)}`;
        const res: any = await safeFetchJson(url);
        if (res?.response?.success === 1 && res.response.steamid) {
          return { steamId64: res.response.steamid };
        }
      } catch (e) {
        // Fall back to public profile resolution
      }
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

      // 1. Primary Strategy: Paginated wishlistdata (gives full metadata and store prices in batch)
      try {
        while (page < maxPages) {
          if (page > 0) {
            // Polite pacing between Steam Storefront wishlist pages (1.5s)
            await new Promise(r => setTimeout(r, Math.max(1500, config.delays.steam)));
          }
          const url = `https://store.steampowered.com/wishlist/profiles/${steamId64}/wishlistdata/?p=${page}`;
          let data: any = null;
          try {
            data = await safeFetchJson(url);
          } catch (fetchErr: any) {
            if (fetchErr?.status === 429) {
              // Transient Steam rate limit hit: backoff for 5 seconds and retry page once
              await new Promise(r => setTimeout(r, 5000));
              try {
                data = await safeFetchJson(url);
              } catch {
                if (page === 0) throw fetchErr;
                break;
              }
            } else {
              if (page === 0) throw fetchErr;
              break; // Finished last page
            }
          }

          if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
            break; // No more items on next page
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
            const headerImage = infoObj.caps || `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
            const capsuleImage = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`;
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
              discountPercent
            });
          }

          if (pageItemsAdded === 0) {
            break;
          }
          page++;
        }

        if (items.length > 0) {
          return items;
        }
      } catch (err) {
        // Fall back to IWishlistService if wishlistdata was blocked or failed
      }

      // 2. Fallback: IWishlistService Web API
      try {
        const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId64}`;
        const data: any = await safeFetchJson(url);
        
        if (data?.response?.items && Array.isArray(data.response.items)) {
          return data.response.items.map((item: any) => ({
            steamAppId: Number(item.appid),
            title: `App ${item.appid}`,
            priority: Number(item.priority ?? 0),
            dateAdded: item.date_added ? new Date(item.date_added * 1000).toISOString() : undefined,
            headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
            capsuleImage: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/capsule_231x87.jpg`,
            isDlc: false,
            isFree: false,
            discountPercent: 0
          }));
        }
      } catch (e) {
        throw new Error(`Failed to fetch Steam Wishlist for ${steamId64}. Ensure the Steam profile & wishlist are set to Public.`);
      }

      return items;
    });
  }

  /**
   * Fetches game metadata & current Steam price for an individual AppID
   */
  public async fetchAppDetails(steamAppId: number): Promise<SteamAppDetails | null> {
    return this.queue.enqueue(async () => {
      const url = `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&cc=${config.preferredCountry.toLowerCase()}&filters=basic,price_overview`;
      const data: any = await safeFetchJson(url);

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

      return {
        steamAppId,
        title: g.name || `App ${steamAppId}`,
        headerImage: g.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/header.jpg`,
        capsuleImage: `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/capsule_231x87.jpg`,
        releaseDate: g.release_date?.date || undefined,
        isDlc: g.type === 'dlc',
        isFree,
        rawPrice,
        rawCurrency,
        rawOriginalPrice,
        basePriceEur,
        currentPriceEur,
        discountPercent
      };
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

