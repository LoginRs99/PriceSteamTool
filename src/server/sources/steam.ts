import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';

export interface SteamWishlistItem {
  steamAppId: number;
  priority: number;
  dateAdded?: string;
}

export interface SteamAppDetails {
  steamAppId: number;
  title: string;
  headerImage?: string;
  capsuleImage?: string;
  releaseDate?: string;
  isDlc: boolean;
  isFree: boolean;
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
    // Check if it's already a 17-digit Steam64 ID (e.g. 76561198012345678)
    if (/^\d{17}$/.test(clean)) {
      return { steamId64: clean };
    }

    // Extract vanity slug from URL if full URL was provided
    let vanitySlug = clean;
    const profileMatch = clean.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
    if (profileMatch) {
      return { steamId64: profileMatch[1] };
    }

    const idMatch = clean.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
    if (idMatch) {
      vanitySlug = idMatch[1];
    }

    // If we have STEAM_API_KEY, use official ResolveVanityURL
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

    // Direct resolution fallback (numeric or direct slug)
    return { steamId64: vanitySlug };
  }

  /**
   * Fetches user wishlist items using Steam Web API
   */
  public async fetchWishlist(steamId64: string): Promise<SteamWishlistItem[]> {
    return this.queue.enqueue(async () => {
      // 1. Try modern IWishlistService endpoint
      try {
        const url = `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId64}`;
        const data: any = await safeFetchJson(url);
        
        if (data?.response?.items && Array.isArray(data.response.items)) {
          return data.response.items.map((item: any) => ({
            steamAppId: Number(item.appid),
            priority: Number(item.priority ?? 0),
            dateAdded: item.date_added ? new Date(item.date_added * 1000).toISOString() : undefined
          }));
        }
      } catch (err) {
        // Fallback to legacy wishlistdata endpoint
      }

      // 2. Try wishlistdata endpoint as fallback
      try {
        const legacyUrl = `https://store.steampowered.com/wishlist/profiles/${steamId64}/wishlistdata/?p=0`;
        const legacyData: any = await safeFetchJson(legacyUrl);
        if (legacyData && typeof legacyData === 'object') {
          return Object.entries(legacyData).map(([appId, info]: [string, any]) => ({
            steamAppId: parseInt(appId, 10),
            priority: Number(info?.priority ?? 0),
            dateAdded: info?.added ? new Date(info.added * 1000).toISOString() : undefined
          }));
        }
      } catch (e) {
        throw new Error(`Failed to fetch Steam Wishlist for ${steamId64}. Ensure the Steam profile & wishlist are set to Public.`);
      }

      return [];
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
      let discountPercent = 0;

      if (priceOverview) {
        // Price in Steam API is in cents (e.g. 1999 -> 19.99)
        basePriceEur = priceOverview.initial ? priceOverview.initial / 100 : undefined;
        currentPriceEur = priceOverview.final ? priceOverview.final / 100 : basePriceEur;
        discountPercent = priceOverview.discount_percent || 0;
      } else if (isFree) {
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
      dealUrl: `https://store.steampowered.com/app/${steamAppId}/`,
      rawPayload: details
    }];
  }
}

export const steamAdapter = new SteamSourceAdapter();
