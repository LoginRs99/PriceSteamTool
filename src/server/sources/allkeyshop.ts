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

interface SolverCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

let cachedSolverCookies: SolverCookie[] = [];
let lastCookieTimestamp = 0;
const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function fetchWithAllkeyshopSolver<T = any>(
  url: string, 
  timeoutMs: number = 15000
): Promise<T | null> {
  const solverUrl = config.allkeyshopSolverUrl?.trim();
  
  if (!solverUrl) {
    return null;
  }

  // Solver Mode: STRICTLY route through Byparr / FlareSolverr only (NO direct IP fallback to prevent IP bans)
  let normalizedUrl = solverUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `http://${normalizedUrl}`;
  }
  const baseEndpoint = normalizedUrl.replace(/\/+$/, '');
  const endpoint = baseEndpoint.endsWith('/v1') ? baseEndpoint : `${baseEndpoint}/v1`;

  const now = Date.now();
  const validCookies = (now - lastCookieTimestamp < COOKIE_TTL_MS) ? cachedSolverCookies : [];

  const maxSolverTimeout = Math.max(15000, timeoutMs);
  const payload: Record<string, any> = {
    cmd: 'request.get',
    url,
    maxTimeout: maxSolverTimeout,
    blockMedia: true,
    returnOnlyCookies: false
  };

  if (validCookies.length > 0) {
    payload.cookies = validCookies;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(maxSolverTimeout + 15000)
    });

    if (!res.ok) {
      console.warn(`Byparr / FlareSolverr returned HTTP ${res.status} for ${url}`);
      const err: any = new AllKeyShopUnavailableError(`Byparr / FlareSolverr returned HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }

    const data: any = await res.json();
    if (data?.status === 'ok' && data?.solution?.status >= 200 && data?.solution?.status < 300) {
      if (Array.isArray(data?.solution?.cookies) && data.solution.cookies.length > 0) {
        cachedSolverCookies = data.solution.cookies;
        lastCookieTimestamp = Date.now();
      }

      let resp = data.solution.response;
      if (typeof resp === 'string') {
        const jsonMatch = resp.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
          resp = jsonMatch[0];
        }
        try {
          return JSON.parse(resp) as T;
        } catch {
          return resp as unknown as T;
        }
      } else if (typeof resp === 'object' && resp !== null) {
        return resp as T;
      }
    } else {
      const solutionStatus = data?.solution?.status || 500;
      console.warn(`Byparr challenge failed (status ${solutionStatus}): ${data?.message || 'Challenge unsolved'}`);
      const err: any = new AllKeyShopUnavailableError(`Byparr challenge failed (status ${solutionStatus}): ${data?.message || 'Challenge unsolved'}`);
      err.status = solutionStatus;
      throw err;
    }
  } catch (solverErr: any) {
    if (solverErr instanceof AllKeyShopUnavailableError) {
      throw solverErr;
    }
    console.warn(`Byparr request failed for ${url}: ${solverErr.message}`);
    const err: any = new AllKeyShopUnavailableError(`Byparr request failed for ${url}: ${solverErr.message}`);
    err.status = 502;
    throw err;
  }

  return null;
}

function extractYear(text?: string): number | null {
  if (!text) return null;
  const match = text.match(/\b(19\d\d|20\d\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

export function loadCustomMappings(): Record<string, string | number> {
  const mappingPath = path.join(process.cwd(), 'data', 'allkeyshop_mapping.json');
  try {
    if (fs.existsSync(mappingPath)) {
      const content = fs.readFileSync(mappingPath, 'utf8');
      return JSON.parse(content);
    }
  } catch {}
  return {};
}

export function saveCustomMapping(steamAppId: number | string, value: string | number | null): void {
  const mappingPath = path.join(process.cwd(), 'data', 'allkeyshop_mapping.json');
  try {
    const dataDir = path.dirname(mappingPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    let mappings: Record<string, string | number> = {};
    if (fs.existsSync(mappingPath)) {
      try {
        mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      } catch {}
    }
    const key = String(steamAppId);
    if (value === null || value === undefined || value === '') {
      delete mappings[key];
    } else {
      mappings[key] = value;
    }
    fs.writeFileSync(mappingPath, JSON.stringify(mappings, null, 2), 'utf8');
  } catch (err: any) {
    console.error('Failed to save AllKeyShop mapping override:', err);
  }
}

export function findCandidateGamesInCatalog(
  catalog: CatalogGame[], 
  gameTitle: string,
  steamAppId?: number,
  releaseDate?: string
): CatalogGame[] {
  if (!catalog || catalog.length === 0) return [];

  // 1. Check custom overrides mapping first (data/allkeyshop_mapping.json)
  const mappings = loadCustomMappings();
  const overrideKey = steamAppId ? String(steamAppId) : null;
  const rawOverride = (overrideKey && mappings[overrideKey]) || mappings[gameTitle] || mappings[gameTitle.toLowerCase()];

  if (rawOverride) {
    if (typeof rawOverride === 'number') {
      const matched = catalog.find(g => g.id === rawOverride);
      if (matched) return [matched];
      return [{ id: rawOverride, name: gameTitle }];
    } else if (typeof rawOverride === 'string') {
      if (/^\d+$/.test(rawOverride)) {
        const idNum = parseInt(rawOverride, 10);
        const matched = catalog.find(g => g.id === idNum);
        if (matched) return [matched];
        return [{ id: idNum, name: gameTitle }];
      }
      const slug = rawOverride.replace(/^https?:\/\/[^/]+\/blog\//, '').replace(/\/+$/, '');
      const matched = catalog.find(g => g.slug === slug || g.name.toLowerCase() === slug.toLowerCase());
      if (matched) return [matched];
      return [{ id: 0, name: gameTitle, slug }];
    }
  }

  const cleanTarget = gameTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanTarget) return [];
  const targetNumbers = cleanTarget.match(/\d+/g)?.join('') || '';
  const steamReleaseYear = extractYear(releaseDate) || extractYear(gameTitle);

  const cleanNumbers = (str: string): string => str.match(/\d+/g)?.join('') || '';

  const candidates: { game: CatalogGame; score: number }[] = [];

  for (const g of catalog) {
    if (!g.name) continue;
    const cleanG = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const gNumbers = cleanNumbers(cleanG);
    const gYear = extractYear(g.name);

    // Filter out mismatched major release years (e.g. Screamer 1995 when Steam release is 2026)
    if (steamReleaseYear && gYear && Math.abs(steamReleaseYear - gYear) > 2) {
      continue;
    }

    // 1. Exact match with release year appended (e.g. Screamer 2026 when steamReleaseYear is 2026)
    if (steamReleaseYear && cleanG === `${cleanTarget}${steamReleaseYear}`) {
      candidates.push({ game: g, score: 100 });
      continue;
    }

    // 2. Exact match
    if (cleanG === cleanTarget) {
      candidates.push({ game: g, score: 80 });
      continue;
    }

    // 3. Suffix match (e.g. Judas 2, Judas (2), Judas Edition)
    if (cleanG.startsWith(cleanTarget)) {
      const suffix = cleanG.slice(cleanTarget.length);
      if (/^(2|3|4|edition|deluxe|standard|goty|remastered|reboot|vr)*$/.test(suffix)) {
        candidates.push({ game: g, score: 75 });
        continue;
      }
    }

    // 4. Base game match (strip standard/deluxe/goty/edition keywords)
    const baseTarget = cleanTarget
      .replace(/standardedition/g, '')
      .replace(/deluxeedition/g, '')
      .replace(/gameoftheyearedition/g, '')
      .replace(/gotyedition/g, '')
      .replace(/goty/g, '')
      .replace(/edition/g, '');

    if (baseTarget.length >= 4 && (gNumbers === targetNumbers)) {
      if (cleanG === baseTarget || cleanG === `${baseTarget}edition` || cleanG === `${baseTarget}deluxe` || cleanG === `${baseTarget}2`) {
        candidates.push({ game: g, score: 60 });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const seenIds = new Set<number>();
  const results: CatalogGame[] = [];
  for (const c of candidates) {
    if (!seenIds.has(c.game.id)) {
      seenIds.add(c.game.id);
      results.push(c.game);
      if (results.length >= 4) break;
    }
  }

  return results;
}

export class AllKeyShopUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllKeyShopUnavailableError';
  }
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
  private catalogFailureCooldownUntil = 0;

  public isEnabled(): boolean {
    return config.allkeyshopEnabled;
  }

  public async ensureCatalog(): Promise<CatalogGame[]> {
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // 1. In-memory cache check
    if (this.cachedCatalog && (now - this.lastCatalogFetch) < ONE_DAY_MS) {
      return this.cachedCatalog;
    }

    if (!this.cachedCatalog && now < this.catalogFailureCooldownUntil) {
      throw new AllKeyShopUnavailableError('AllKeyShop catalog unavailable (solver cooldown active)');
    }

    if (this.pendingCatalogLoad) {
      return this.pendingCatalogLoad;
    }

    this.pendingCatalogLoad = (async (): Promise<CatalogGame[]> => {
      // 2. Check local disk cache
      try {
        if (fs.existsSync(this.catalogPath)) {
          const stat = fs.statSync(this.catalogPath);
          if (now - stat.mtimeMs < ONE_DAY_MS) {
            const raw = fs.readFileSync(this.catalogPath, 'utf8');
            const data = JSON.parse(raw);
            if (data?.status === 'success' && Array.isArray(data?.games) && data.games.length > 0) {
              this.cachedCatalog = data.games;
              this.lastCatalogFetch = stat.mtimeMs;
              return this.cachedCatalog || [];
            }
          }
        }
      } catch {}

      // 3. Remote download via FlareSolverr/Byparr or direct fetch
      try {
        const url = 'https://www.allkeyshop.com/api/vaks.php?action=products&v=2';
        const data: any = await fetchWithAllkeyshopSolver(url, 20000);

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
      } catch (err: any) {
        console.warn('Failed to download AllKeyShop catalog:', err.message);
      }

      // 4. If remote download failed, try reading whatever is cached on disk (even if older than 24h)
      try {
        if (!this.cachedCatalog && fs.existsSync(this.catalogPath)) {
          const raw = fs.readFileSync(this.catalogPath, 'utf8');
          const data = JSON.parse(raw);
          if (data?.status === 'success' && Array.isArray(data?.games) && data.games.length > 0) {
            this.cachedCatalog = data.games;
          }
        }
      } catch {}

      this.catalogFailureCooldownUntil = now + (15 * 60 * 1000);

      if (this.cachedCatalog) return this.cachedCatalog;
      throw new AllKeyShopUnavailableError('AllKeyShop catalog fetch failed and no cache available');
    })();

    try {
      const result = await this.pendingCatalogLoad;
      return result || [];
    } finally {
      this.pendingCatalogLoad = null;
    }
  }

  public async fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string,
    itadId?: string,
    releaseDate?: string
  ): Promise<NormalizedSourceOffer[]> {
    return this.queue.enqueue(async () => {
      try {
        const catalog = await this.ensureCatalog();
        const candidates = findCandidateGamesInCatalog(catalog, gameTitle, steamAppId, releaseDate);
        if (candidates.length === 0) {
          return [];
        }

        // Probe candidates in priority order and select the one with active offers
        for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
          const matched = candidates[cIdx];
          if (!matched || (!matched.id && !matched.slug)) continue;

          if (cIdx > 0) {
            await new Promise(r => setTimeout(r, Math.max(1000, config.delays.allkeyshop)));
          }

          const priceApiUrl = matched.id 
            ? `https://www.allkeyshop.com/api/price_history_api.php?normalised_name=${matched.id}&currency=EUR&database=allkeyshop.com&v2=1`
            : `https://www.allkeyshop.com/api/price_history_api.php?normalised_name=${encodeURIComponent(matched.slug || '')}&currency=EUR&database=allkeyshop.com&v2=1`;

          const raw: any = await fetchWithAllkeyshopSolver(priceApiUrl, 15000);
          if (!raw) continue;

          const resolveName = (dict: any, id: any) => dict?.[String(id)]?.name ?? '';
          const officialMerchantIds: number[] = Array.isArray(raw?.officialMerchants) ? raw.officialMerchants : [];

          // Build game slug for direct comparison page link
          const cleanSlug = (matched.slug || matched.name || gameTitle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const defaultDealUrl = cleanSlug.startsWith('buy-')
            ? `https://www.allkeyshop.com/blog/${encodeURIComponent(cleanSlug)}/`
            : `https://www.allkeyshop.com/blog/buy-${encodeURIComponent(cleanSlug)}-cd-key-compare-prices/`;

          const historyEntries: any[] = Array.isArray(raw?.history) ? raw.history : [];
          if (historyEntries.length === 0) continue;

          // Determine the latest observation timestamp across the feed
          let latestTime = 0;
          for (const h of historyEntries) {
            const tStr = h?.end || h?.start;
            if (tStr) {
              const t = new Date(tStr).getTime();
              if (!isNaN(t) && t > latestTime) latestTime = t;
            }
          }

          // Active offer window: within 72 hours of the latest observed snapshot
          const ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;
          const merchantOffers = new Map<string, NormalizedSourceOffer>();

          for (const entry of historyEntries) {
            if (!entry) continue;

            // Reject dead historical records from past months/years
            const entryEndTime = entry.end ? new Date(entry.end).getTime() : entry.start ? new Date(entry.start).getTime() : NaN;
            if (latestTime > 0 && !isNaN(entryEndTime) && (latestTime - entryEndTime) > ACTIVE_WINDOW_MS) {
              continue;
            }

            const merchantName = resolveName(raw.merchants, entry.merchant_id);
            const editionName = resolveName(raw.editions, entry.edition);
            const regionName = resolveName(raw.regions, entry.region);

            if (!merchantName) continue;

            // Reject non-Steam platforms
            const isNonSteam = [
              'xbox', 'ps4', 'ps5', 'ps3', 'switch', 'nintendo', 'wii',
              'gog', 'epic', 'origin', 'uplay', 'ubisoft', 'ea app', 
              'battle.net', 'blizzard', 'rockstar', 'windows 10', 'windows 11',
              'account'
            ].some(s => 
              regionName.toLowerCase().includes(s) || 
              editionName.toLowerCase().includes(s) || 
              merchantName.toLowerCase().includes(s) ||
              (matched.name && matched.name.toLowerCase().includes(s))
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

            // Keep cheapest active offer per merchant
            if (!existing || existing.priceEur > priceEur) {
              merchantOffers.set(offerKey, {
                merchantCode,
                merchantName,
                isOfficial,
                productTypeRaw,
                regionRaw,
                priceEur,
                originalPriceEur: entry.original_price ? Number(entry.original_price) : undefined,
                voucherCode,
                dealUrl: entry.url || defaultDealUrl
              });
            }
          }

          const offers = Array.from(merchantOffers.values());
          if (offers.length > 0) {
            return offers;
          }
        }

        return [];
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.message?.includes('timeout') || err?.message?.includes('aborted')) {
          const timeoutErr: any = new Error('AllKeyShop request timed out (firewall packet drop)');
          timeoutErr.status = 429;
          throw timeoutErr;
        }
        if (err?.status === 403 || err?.status === 429) {
          throw err;
        }
        if (err?.name === 'AllKeyShopUnavailableError') {
          throw err;
        }
        console.warn(`AllKeyShop fetchPricesForGame failed for ${gameTitle}:`, err.message);
        return [];
      }
    });
  }
}

export const allkeyshopAdapter = new AllKeyShopSourceAdapter();
