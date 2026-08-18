import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';

interface CatalogGame {
  id: number;
  name: string;
  slug?: string;
}

const ALLKEYSHOP_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
];

export function getRandomAllkeyshopUserAgent(): string {
  const idx = Math.floor(Math.random() * ALLKEYSHOP_USER_AGENTS.length);
  return ALLKEYSHOP_USER_AGENTS[idx];
}

export function getAllkeyshopHeaders(uaOverride?: string): Record<string, string> {
  const ua = uaOverride || getRandomAllkeyshopUserAgent();
  const isChromium = ua.includes('Chrome') || ua.includes('Edg');
  const isMac = ua.includes('Macintosh');
  const platform = isMac ? '"macOS"' : '"Windows"';

  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,hu;q=0.8',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Referer': 'https://www.allkeyshop.com/blog/'
  };

  if (isChromium) {
    headers['Sec-CH-UA'] = '"Chromium";v="126", "Not/A)Brand";v="8"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = platform;
  }

  return headers;
}

export class AllKeyShopSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'allkeyshop' as const;
  public readonly name = 'AllKeyShop';
  public readonly supportsBatch = false;
  private queue = new PacedSourceQueue('allkeyshop', config.delays.allkeyshop, config.allkeyshopJitterMs);

  private cachedCatalog: CatalogGame[] | null = null;
  private lastCatalogFetch = 0;
  private pendingCatalogLoad: Promise<CatalogGame[]> | null = null;
  private catalogPath = path.join(process.cwd(), 'data', 'allkeyshop_catalog.json');

  public isEnabled(): boolean {
    return true;
  }

  private async ensureCatalog(): Promise<CatalogGame[]> {
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // 1. In-memory cache check
    if (this.cachedCatalog && (now - this.lastCatalogFetch) < ONE_DAY_MS) {
      return this.cachedCatalog;
    }

    if (this.pendingCatalogLoad) {
      return this.pendingCatalogLoad;
    }

    this.pendingCatalogLoad = (async (): Promise<CatalogGame[]> => {
      // 2. Check local disk cache
      try {
        if (fs.existsSync(this.catalogPath)) {
          const stats = fs.statSync(this.catalogPath);
          if ((now - stats.mtimeMs) < ONE_DAY_MS) {
            const raw = fs.readFileSync(this.catalogPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.games) && parsed.games.length > 0) {
              this.cachedCatalog = parsed.games;
              this.lastCatalogFetch = stats.mtimeMs;
              return parsed.games;
            }
          }
        }
      } catch (err) {
        console.warn('Could not read cached AllKeyShop catalog from disk:', err);
      }

      // 3. Download fresh catalog from AllKeyShop with 10s timeout
      try {
        const url = 'https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&currency=eur';
        const res = await fetch(url, {
          headers: getAllkeyshopHeaders(),
          signal: AbortSignal.timeout(10000)
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data?.status === 'success' && Array.isArray(data?.games) && data.games.length > 0) {
            this.cachedCatalog = data.games;
            this.lastCatalogFetch = Date.now();
            try {
              const dataDir = path.dirname(this.catalogPath);
              if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
              }
              fs.writeFileSync(this.catalogPath, JSON.stringify(data), 'utf8');
            } catch {}
            return this.cachedCatalog || [];
          }
        }
      } catch (err: any) {
        console.warn('Failed to download AllKeyShop catalog:', err.message);
      }

      return this.cachedCatalog || [];
    })();

    try {
      const result = await this.pendingCatalogLoad;
      return result || [];
    } finally {
      this.pendingCatalogLoad = null;
    }
  }

  private matchGameInCatalog(catalog: CatalogGame[], gameTitle: string): CatalogGame | null {
    if (!catalog || catalog.length === 0) return null;

    const cleanTarget = gameTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanTarget) return null;
    const targetNumbers = cleanTarget.match(/\d+/g)?.join('') || '';

    // 1. Exact cleaned match
    const exact = catalog.find(g => (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget);
    if (exact) return exact;

    // 2. Base game match (strip standard/deluxe/goty/edition keywords)
    const baseTarget = cleanTarget
      .replace(/standardedition/g, '')
      .replace(/deluxeedition/g, '')
      .replace(/gameoftheyearedition/g, '')
      .replace(/gotyedition/g, '')
      .replace(/goty/g, '')
      .replace(/edition/g, '');

    if (baseTarget.length >= 4) {
      const baseMatch = catalog.find(g => {
        const cleanG = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cleanNumbers(cleanG) !== targetNumbers) return false;
        return cleanG === baseTarget || cleanG === `${baseTarget}edition` || cleanG === `${baseTarget}deluxe`;
      });
      if (baseMatch) return baseMatch;
    }

    // 3. Strict prefix match (only allow edition suffixes and ensure numbers match strictly)
    if (cleanTarget.length >= 6) {
      const prefixMatch = catalog.find(g => {
        const cleanG = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Require numeric equality so sequel "Game 2" never matches "Game 3" or "Game 1"
        if (cleanNumbers(cleanG) !== targetNumbers) return false;
        if (cleanG.startsWith(cleanTarget)) {
          const suffix = cleanG.slice(cleanTarget.length);
          return /^(edition|deluxe|standard|goty|remastered|vr|director|cut)*$/.test(suffix);
        }
        return false;
      });
      if (prefixMatch) return prefixMatch;
    }

    return null;

    function cleanNumbers(str: string): string {
      return str.match(/\d+/g)?.join('') || '';
    }
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    return this.queue.enqueue(async () => {
      const offers: NormalizedSourceOffer[] = [];
      try {
        const catalog = await this.ensureCatalog();
        const matched = this.matchGameInCatalog(catalog, gameTitle);
        if (!matched || !matched.id) {
          return offers;
        }

        const priceApiUrl = `https://www.allkeyshop.com/api/price_history_api.php?normalised_name=${matched.id}&currency=EUR&database=allkeyshop.com&v2=1`;
        const res = await fetch(priceApiUrl, {
          headers: getAllkeyshopHeaders(),
          signal: AbortSignal.timeout(8000)
        });

        if (res.status === 403 || res.status === 429) {
          const err: any = new Error(`AllKeyShop rate limit or challenge (${res.status})`);
          err.status = res.status;
          throw err;
        }

        if (!res.ok) return offers;

        const raw: any = await res.json();
        const resolveName = (dict: any, id: any) => dict?.[String(id)]?.name ?? '';
        const officialMerchantIds: number[] = Array.isArray(raw?.officialMerchants) ? raw.officialMerchants : [];

        // Build game slug for direct comparison page link
        const cleanSlug = (matched.name || gameTitle)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const defaultDealUrl = `https://www.allkeyshop.com/blog/buy-${encodeURIComponent(cleanSlug)}-cd-key-compare-prices/`;

        const merchantOffers = new Map<string, NormalizedSourceOffer>();

        for (const entry of (raw?.history || [])) {
          const merchantName = resolveName(raw.merchants, entry.merchant_id);
          const editionName = resolveName(raw.editions, entry.edition);
          const regionName = resolveName(raw.regions, entry.region);

          if (!merchantName) continue;

          // Reject non-Steam platforms (Xbox, PlayStation, Switch, GOG, Epic, Origin, Ubisoft, EA App, Windows 10)
          const isNonSteam = ['xbox', 'ps4', 'ps5', 'switch', 'nintendo', 'gog', 'epic', 'origin', 'uplay', 'ubisoft', 'ea app', 'windows 10'].some(s => 
            regionName.toLowerCase().includes(s) || editionName.toLowerCase().includes(s) || merchantName.toLowerCase().includes(s)
          );
          if (isNonSteam) continue;

          const priceEur = Number(entry.min_discount_price || entry.last_price);
          if (isNaN(priceEur) || priceEur <= 0) continue;

          const merchantCode = merchantName.toLowerCase().replace(/[^a-z0-9]+/g, '');
          const isOfficial = officialMerchantIds.includes(Number(entry.merchant_id));
          const isGift = regionName.toLowerCase().includes('gift') || editionName.toLowerCase().includes('gift');
          const productTypeRaw = isGift ? 'Steam Gift' : 'Steam Key';
          const voucherCode = entry.best_discount_code ? String(entry.best_discount_code).trim() : undefined;

          // Regional formatting
          let regionRaw = 'GLOBAL';
          if (regionName.toLowerCase().includes('eu') || regionName.toLowerCase().includes('europe')) {
            regionRaw = 'EU';
          } else if (regionName.toLowerCase().includes('row')) {
            regionRaw = 'ROW';
          }

          const offerKey = `${merchantCode}_${productTypeRaw}`;
          const existing = merchantOffers.get(offerKey);

          // Keep cheapest offer per merchant
          if (!existing || existing.priceEur > priceEur) {
            merchantOffers.set(offerKey, {
              merchantCode,
              merchantName,
              isOfficial,
              productTypeRaw,
              regionRaw,
              priceEur,
              voucherCode,
              dealUrl: defaultDealUrl,
              rawPayload: entry
            });
          }
        }

        return Array.from(merchantOffers.values());
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.message?.includes('timeout') || err?.message?.includes('aborted')) {
          const timeoutErr: any = new Error('AllKeyShop request timed out (firewall packet drop)');
          timeoutErr.status = 429;
          throw timeoutErr;
        }
        if (err?.status === 403 || err?.status === 429) {
          throw err;
        }
      }
      return offers;
    });
  }
}

export const allkeyshopAdapter = new AllKeyShopSourceAdapter();
