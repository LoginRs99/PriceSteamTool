import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config/index.js';
import { type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { allkeyshopQueue } from '../sync/allkeyshop/index.js';
import { circuitBreakers } from '../sync/circuitBreaker.js';
import { normalizeGameTitle, convertRomanNumerals, repairMojibake } from '../domain/normalizer.js';

export const ALLOWED_AKS_HOST = 'www.allkeyshop.com';

export function stripPublisherPrefixes(title: string): string {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/^(tom clancy'?s|sid meier'?s|warhammer 40[,.]?000:?|ea sports|marvel'?s|disney'?s|the|a|an)\s+/i, '')
    .trim();
}

export function parseRetryAfterHeader(headerValue: string | null | undefined, defaultDelaySec = 30): number {
  if (!headerValue || typeof headerValue !== 'string') return defaultDelaySec;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10);
    return Number.isSafeInteger(sec) && sec > 0 ? sec : defaultDelaySec;
  }
  if (/^[a-zA-Z]{3},|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(trimmed)) {
    const dateMs = new Date(trimmed).getTime();
    if (!isNaN(dateMs)) {
      const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
      return Math.max(1, diffSec);
    }
  }
  return defaultDelaySec;
}

export function buildAksApiUrl(action: string, params: Record<string, string | number>): string {
  if (!action || typeof action !== 'string' || action.includes('..') || action.startsWith('/') || action.includes('://')) {
    throw new Error(`Invalid action path: ${action}`);
  }
  const url = new URL(`https://${ALLOWED_AKS_HOST}/api/${action}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class AllKeyShopUnavailableError extends Error {
  public status?: number;
  public retryAfterSec?: number;

  constructor(message: string, status?: number, retryAfterSec?: number) {
    super(message);
    this.name = 'AllKeyShopUnavailableError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface CatalogGame {
  id: number;
  name: string;
  slug?: string;
  _matchScore?: number;
}

export interface AllKeyShopCatalogApiResponse {
  status: string;
  games: CatalogGame[];
}

export interface AllKeyShopHistoryEntry {
  merchant_id: number | string;
  edition?: number | string;
  region?: number | string;
  min_discount_price?: number | string;
  last_price?: number | string;
  original_price?: number | string;
  best_discount_code?: string | null;
  url?: string;
  start?: string;
  end?: string;
}

export interface AllKeyShopPriceApiResponse {
  history: AllKeyShopHistoryEntry[];
  merchants?: Record<string, { name: string }>;
  editions?: Record<string, { name: string }>;
  regions?: Record<string, { name: string }>;
  officialMerchants?: number[];
}

export function validateAllKeyShopPriceResponse(data: unknown): AllKeyShopPriceApiResponse | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.history)) return null;
  return {
    history: obj.history.filter((h): h is AllKeyShopHistoryEntry => typeof h === 'object' && h !== null),
    merchants: typeof obj.merchants === 'object' && obj.merchants !== null ? obj.merchants as Record<string, { name: string }> : {},
    editions: typeof obj.editions === 'object' && obj.editions !== null ? obj.editions as Record<string, { name: string }> : {},
    regions: typeof obj.regions === 'object' && obj.regions !== null ? obj.regions as Record<string, { name: string }> : {},
    officialMerchants: Array.isArray(obj.officialMerchants) ? obj.officialMerchants.map(Number).filter(n => !isNaN(n)) : []
  };
}

export function validateAllKeyShopCatalog(data: unknown): AllKeyShopCatalogApiResponse | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (obj.status !== 'success' || !Array.isArray(obj.games)) return null;
  return {
    status: 'success',
    games: obj.games.filter((g): g is CatalogGame => 
      typeof g === 'object' && g !== null && typeof (g as any).id === 'number' && typeof (g as any).name === 'string'
    )
  };
}

export function parseAllKeyShopGamePage(html: string, defaultDealUrl: string): NormalizedSourceOffer[] {
  if (!html || typeof html !== 'string') return [];
  const m = html.match(/var\s+gamePageTrans\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return [];

  try {
    const data = JSON.parse(m[1]);
    const merchants = typeof data.merchants === 'object' && data.merchants !== null ? data.merchants : {};
    const editions = typeof data.editions === 'object' && data.editions !== null ? data.editions : {};
    const regions = typeof data.regions === 'object' && data.regions !== null ? data.regions : {};
    const prices = Array.isArray(data.prices) ? data.prices : [];

    const merchantOffers = new Map<string, NormalizedSourceOffer>();

    for (const p of prices) {
      if (!p || typeof p !== 'object') continue;

      // 1. Exclude Steam account sales (only want game activation keys/gifts)
      if (p.account) continue;

      // 2. Exclude out of stock items
      if (p.dispo !== undefined && p.dispo !== 1 && p.dispo !== '1') continue;

      // 3. Platform check: Steam only
      if (p.activationPlatform && typeof p.activationPlatform === 'string') {
        if (p.activationPlatform.toLowerCase() !== 'steam') continue;
      }

      const merchantObj = merchants[p.merchant] || {};
      const merchantName = merchantObj.name || p.merchantName || '';
      if (!merchantName) continue;

      const merchantCode = merchantName.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const isOfficial = Boolean(merchantObj.official || p.isOfficial);

      // Prefer priceCard (price incl. credit card fees) as the real user-facing price
      const priceEur = Number(p.priceCard || p.price || p.originalPrice);
      if (isNaN(priceEur) || priceEur <= 0 || (priceEur > 0 && priceEur <= 0.05)) continue;

      const rawBarePrice = p.price !== undefined ? Number(p.price) : undefined;
      const rawOriginalPrice = p.originalPrice !== undefined ? Number(p.originalPrice) : undefined;

      const editionName = editions[p.edition]?.name || undefined;
      const regionName = regions[p.region]?.name || 'GLOBAL';

      let regionRaw = 'GLOBAL';
      if (regionName.toLowerCase().includes('eu') || regionName.toLowerCase().includes('europe')) {
        regionRaw = 'EU';
      } else if (regionName.toLowerCase().includes('row')) {
        regionRaw = 'ROW';
      }

      const isGift = regionName.toLowerCase().includes('gift') || (editionName && editionName.toLowerCase().includes('gift'));
      const productTypeRaw = isGift ? 'Steam Gift' : 'Steam Key';
      const voucherCode = p.voucher_code ? String(p.voucher_code).trim() : undefined;

      const offerKey = `${merchantCode}_${productTypeRaw}`;
      const existing = merchantOffers.get(offerKey);

      // Keep cheapest in-stock offer per merchant
      if (!existing || existing.priceEur > priceEur) {
        merchantOffers.set(offerKey, {
          merchantCode,
          merchantName,
          isOfficial,
          productTypeRaw,
          regionRaw,
          priceEur,
          originalPriceEur: rawOriginalPrice,
          rawPrice: rawBarePrice ?? priceEur,
          rawCurrency: 'EUR',
          rawOriginalPrice,
          voucherCode,
          dealUrl: defaultDealUrl,
          editionName,
          rawPayload: p
        });
      }
    }

    return Array.from(merchantOffers.values());
  } catch (err: any) {
    console.warn('Failed to parse AllKeyShop gamePageTrans:', err?.message);
    return [];
  }
}

export function parseAllKeyShopPriceHistory(
  validated: AllKeyShopPriceApiResponse,
  defaultDealUrl: string
): NormalizedSourceOffer[] {
  const resolveName = (dict: Record<string, { name: string }> | undefined, id: any) => dict?.[String(id)]?.name ?? '';
  const officialMerchantIds = validated.officialMerchants || [];
  const historyEntries = validated.history;
  if (historyEntries.length === 0) return [];

  // Determine latest observation timestamp across feed
  let latestTime = 0;
  for (const h of historyEntries) {
    const tStr = h?.end || h?.start;
    if (tStr) {
      const t = new Date(tStr).getTime();
      if (!isNaN(t) && t > latestTime) latestTime = t;
    }
  }

  // Group by (merchant_id, edition, region) and keep the MOST RECENT observation entry
  const latestEntriesBySubKey = new Map<string, { entry: AllKeyShopHistoryEntry; timestamp: number }>();
  const ACTIVE_WINDOW_MS = 72 * 60 * 60 * 1000;

  for (const entry of historyEntries) {
    if (!entry) continue;

    const entryTime = entry.end ? new Date(entry.end).getTime() : entry.start ? new Date(entry.start).getTime() : NaN;
    if (isNaN(entryTime)) continue;

    // Reject dead historical records older than active window from latest observed time
    if (latestTime > 0 && (latestTime - entryTime) > ACTIVE_WINDOW_MS) {
      continue;
    }

    const subKey = `${entry.merchant_id}_${entry.edition || '1'}_${entry.region || '2'}`;
    const existing = latestEntriesBySubKey.get(subKey);
    if (!existing || entryTime > existing.timestamp) {
      latestEntriesBySubKey.set(subKey, { entry, timestamp: entryTime });
    }
  }

  const merchantOffers = new Map<string, NormalizedSourceOffer>();

  for (const { entry } of latestEntriesBySubKey.values()) {
    const merchantName = resolveName(validated.merchants, entry.merchant_id);
    const editionName = resolveName(validated.editions, entry.edition);
    const regionName = resolveName(validated.regions, entry.region);

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
      merchantName.toLowerCase().includes(s)
    );
    if (isNonSteam) continue;

    const priceEur = Number(entry.min_discount_price || entry.last_price);
    if (isNaN(priceEur) || priceEur <= 0 || (priceEur > 0 && priceEur <= 0.05)) continue;

    const merchantCode = merchantName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const isOfficial = officialMerchantIds.includes(Number(entry.merchant_id));
    const isGift = regionName.toLowerCase().includes('gift') || editionName.toLowerCase().includes('gift');
    const productTypeRaw = isGift ? 'Steam Gift' : 'Steam Key';
    const voucherCode = entry.best_discount_code ? String(entry.best_discount_code).trim() : undefined;

    let regionRaw = 'GLOBAL';
    if (regionName.toLowerCase().includes('eu') || regionName.toLowerCase().includes('europe')) {
      regionRaw = 'EU';
    } else if (regionName.toLowerCase().includes('row')) {
      regionRaw = 'ROW';
    }

    const offerKey = `${merchantCode}_${productTypeRaw}`;
    const existing = merchantOffers.get(offerKey);

    // If multiple active keys/editions exist for same merchant, keep the cheapest
    if (!existing || existing.priceEur > priceEur) {
      const rawOriginal = entry.original_price 
        ? Number(entry.original_price) 
        : (entry.last_price && Number(entry.last_price) > priceEur ? Number(entry.last_price) : undefined);

      merchantOffers.set(offerKey, {
        merchantCode,
        merchantName,
        isOfficial,
        productTypeRaw,
        regionRaw,
        priceEur,
        originalPriceEur: rawOriginal,
        rawOriginalPrice: rawOriginal,
        rawPrice: entry.last_price ? Number(entry.last_price) : priceEur,
        rawCurrency: 'EUR',
        voucherCode,
        dealUrl: entry.url || defaultDealUrl,
        editionName: editionName || undefined,
        rawPayload: entry
      });
    }
  }

  return Array.from(merchantOffers.values());
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
      cachedSolverCookies = [];
      lastCookieTimestamp = 0;
      let retryAfter: number | undefined;
      const retryHeader = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : undefined;
      if (retryHeader) {
        retryAfter = parseRetryAfterHeader(retryHeader, 30);
      }
      throw new AllKeyShopUnavailableError(
        `Byparr / FlareSolverr returned HTTP ${res.status} for ${url}`,
        res.status,
        retryAfter
      );
    }

    const data: any = await res.json();
    if (data?.status === 'ok' && data?.solution?.status >= 200 && data?.solution?.status < 300) {
      if (Array.isArray(data?.solution?.cookies) && data.solution.cookies.length > 0) {
        cachedSolverCookies = data.solution.cookies;
        lastCookieTimestamp = Date.now();
      }

      let resp = data.solution.response;
      if (typeof resp === 'string') {
        const trimmed = resp.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return JSON.parse(trimmed) as T;
          } catch {}
        }
        const preMatch = resp.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) {
          const preTrimmed = preMatch[1].trim();
          if (preTrimmed.startsWith('{') || preTrimmed.startsWith('[')) {
            try {
              return JSON.parse(preTrimmed) as T;
            } catch {}
          }
        }
        return resp as unknown as T;
      } else if (typeof resp === 'object' && resp !== null) {
        return resp as T;
      }
    } else {
      // Challenge failed: clear cookies so next attempt isn't poisoned
      cachedSolverCookies = [];
      lastCookieTimestamp = 0;

      const solutionStatus = data?.solution?.status || (data?.message?.includes('Timeout') ? 408 : 500);
      let retryAfter: number | undefined;
      const h = data?.solution?.headers;
      const retryHeader = h?.['retry-after'] || h?.['Retry-After'];
      if (retryHeader) {
        retryAfter = parseRetryAfterHeader(String(retryHeader), 30);
      }
      console.warn(`Byparr challenge failed (status ${solutionStatus}): ${data?.message || 'Challenge unsolved'}`);
      throw new AllKeyShopUnavailableError(
        `Byparr challenge failed (status ${solutionStatus}): ${data?.message || 'Challenge unsolved'}`,
        solutionStatus,
        retryAfter
      );
    }
  } catch (solverErr: any) {
    if (solverErr instanceof AllKeyShopUnavailableError) {
      throw solverErr;
    }
    console.warn(`Byparr request failed for ${url}: ${solverErr.message}`);
    throw new AllKeyShopUnavailableError(
      `Byparr request failed for ${url}: ${solverErr.message}`,
      502
    );
  }

  return null;
}

function extractYear(text?: string): number | null {
  if (!text) return null;
  const match = text.match(/\b(19\d\d|20\d\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

let cachedMappings: Record<string, string | number> | null = null;

export function loadCustomMappings(): Record<string, string | number> {
  if (cachedMappings) return cachedMappings;
  const mappingPath = path.join(config.dataDir, 'allkeyshop_mapping.json');
  try {
    if (fs.existsSync(mappingPath)) {
      const content = fs.readFileSync(mappingPath, 'utf8');
      cachedMappings = JSON.parse(content);
      return cachedMappings || {};
    }
  } catch {}
  cachedMappings = {};
  return cachedMappings;
}

export function saveCustomMapping(steamAppId: number | string, value: string | number | null): void {
  const mappings = { ...loadCustomMappings() };
  const key = String(steamAppId);
  if (value === null || value === undefined || value === '') {
    delete mappings[key];
  } else {
    mappings[key] = value;
  }
  cachedMappings = mappings;

  const mappingPath = path.join(config.dataDir, 'allkeyshop_mapping.json');
  try {
    const dataDir = path.dirname(mappingPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(mappingPath, JSON.stringify(mappings, null, 2), 'utf8');
  } catch (err: any) {
    console.error('Failed to save AllKeyShop mapping override:', err);
  }
}

export class AllKeyShopCatalogIndex {
  private byId = new Map<number, CatalogGame>();
  private bySlug = new Map<string, CatalogGame>();
  private byCleanName = new Map<string, CatalogGame[]>();
  private byPrefix = new Map<string, CatalogGame[]>();
  private catalogRef: CatalogGame[] = [];

  constructor(catalog: CatalogGame[]) {
    this.build(catalog);
  }

  public build(catalog: CatalogGame[]): void {
    this.byId.clear();
    this.bySlug.clear();
    this.byCleanName.clear();
    this.byPrefix.clear();
    this.catalogRef = catalog || [];

    for (const g of this.catalogRef) {
      if (!g) continue;
      if (g.id) this.byId.set(g.id, g);
      if (g.slug) this.bySlug.set(g.slug.toLowerCase(), g);

      if (g.name) {
        const repaired = repairMojibake(g.name);
        const norm = normalizeGameTitle(repaired);
        const stripped = stripPublisherPrefixes(repaired);
        const normStripped = normalizeGameTitle(stripped);

        const cleanNames = new Set([
          g.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
          repaired.toLowerCase().replace(/[^a-z0-9]/g, ''),
          norm,
          stripped.toLowerCase().replace(/[^a-z0-9]/g, ''),
          normStripped
        ]);

        for (const clean of cleanNames) {
          if (!clean) continue;
          const list = this.byCleanName.get(clean);
          if (list) {
            if (!list.includes(g)) list.push(g);
          } else {
            this.byCleanName.set(clean, [g]);
          }

          const pfx = clean.slice(0, 3);
          if (pfx) {
            const pList = this.byPrefix.get(pfx);
            if (pList) {
              if (!pList.includes(g)) pList.push(g);
            } else {
              this.byPrefix.set(pfx, [g]);
            }
          }
        }
      }
    }
  }

  public getById(id: number): CatalogGame | undefined {
    return this.byId.get(id);
  }

  public getBySlug(slug: string): CatalogGame | undefined {
    return this.bySlug.get(slug.toLowerCase());
  }

  public getByCleanName(clean: string): CatalogGame[] {
    return this.byCleanName.get(clean) || [];
  }

  public getByPrefix(pfx: string): CatalogGame[] {
    return this.byPrefix.get(pfx.slice(0, 3)) || [];
  }

  public get fullCatalog(): CatalogGame[] {
    return this.catalogRef;
  }
}

export function findCandidateGamesInCatalog(
  catalogOrIndex: CatalogGame[] | AllKeyShopCatalogIndex,
  gameTitle: string,
  steamAppId?: number,
  releaseDate?: string
): CatalogGame[] {
  if (!catalogOrIndex) return [];

  const index = catalogOrIndex instanceof AllKeyShopCatalogIndex
    ? catalogOrIndex
    : new AllKeyShopCatalogIndex(catalogOrIndex);

  // 1. Check custom overrides mapping first (data/allkeyshop_mapping.json)
  const mappings = loadCustomMappings();
  const overrideKey = steamAppId ? String(steamAppId) : null;
  const rawOverride = (overrideKey && mappings[overrideKey]) || mappings[gameTitle] || mappings[gameTitle.toLowerCase()];

  if (rawOverride) {
    if (typeof rawOverride === 'number') {
      const matched = index.getById(rawOverride);
      if (matched) return [matched];
      return [{ id: rawOverride, name: gameTitle }];
    } else if (typeof rawOverride === 'string') {
      if (/^\d+$/.test(rawOverride)) {
        const idNum = parseInt(rawOverride, 10);
        const matched = index.getById(idNum);
        if (matched) return [matched];
        return [{ id: idNum, name: gameTitle }];
      }
      const slug = rawOverride.replace(/^https?:\/\/[^/]+\/blog\//, '').replace(/\/+$/, '');
      const matched = index.getBySlug(slug) || index.getByCleanName(slug.toLowerCase().replace(/[^a-z0-9]/g, ''))[0];
      if (matched) return [matched];
      return [{ id: 0, name: gameTitle, slug }];
    }
  }

  const repairedTarget = repairMojibake(gameTitle);
  const cleanTarget = repairedTarget.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanTarget) return [];
  const normalizedTarget = normalizeGameTitle(repairedTarget);
  const strippedTarget = stripPublisherPrefixes(repairedTarget);
  const cleanStripped = strippedTarget.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normStripped = normalizeGameTitle(strippedTarget);

  const targetNumbers = cleanTarget.match(/\d+/g)?.join('') || '';
  const normalizedNumbers = normalizedTarget.match(/\d+/g)?.join('') || '';
  const steamReleaseYear = extractYear(releaseDate) || extractYear(gameTitle);

  const cleanNumbers = (str: string): string => str.match(/\d+/g)?.join('') || '';

  const candidates: { game: CatalogGame; score: number }[] = [];

  // Scoped candidate search: check exact matches and prefix buckets for original & stripped names
  const poolSet = new Set<CatalogGame>();
  if (cleanTarget.length >= 3) {
    for (const g of index.getByPrefix(cleanTarget)) poolSet.add(g);
  }
  if (cleanStripped.length >= 3) {
    for (const g of index.getByPrefix(cleanStripped)) poolSet.add(g);
  }
  if (normalizedTarget.length >= 3) {
    for (const g of index.getByPrefix(normalizedTarget)) poolSet.add(g);
  }
  if (normStripped.length >= 3) {
    for (const g of index.getByPrefix(normStripped)) poolSet.add(g);
  }

  const pool = poolSet.size > 0 ? Array.from(poolSet) : index.fullCatalog;

  for (const g of pool) {
    if (!g.name) continue;
    const cleanG = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normG = normalizeGameTitle(g.name);
    const strippedG = stripPublisherPrefixes(g.name);
    const cleanStrippedG = strippedG.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normStrippedG = normalizeGameTitle(strippedG);

    const gNumbers = cleanNumbers(cleanG);
    const gNormNumbers = cleanNumbers(normG);
    const gYear = extractYear(g.name);

    // Filter out mismatched major release years (e.g. Screamer 1995 when Steam release is 2026)
    if (steamReleaseYear && gYear && Math.abs(steamReleaseYear - gYear) > 2) {
      continue;
    }

    // 1. Exact match with release year appended (e.g. Screamer 2026 when steamReleaseYear is 2026)
    if (
      steamReleaseYear &&
      (cleanG === `${cleanTarget}${steamReleaseYear}` ||
       cleanG === `${cleanStripped}${steamReleaseYear}` ||
       cleanStrippedG === `${cleanStripped}${steamReleaseYear}`)
    ) {
      candidates.push({ game: g, score: 100 });
      continue;
    }

    // 2. Exact match on raw clean name, normalized name, or franchise-stripped name
    const isExactMatch =
      cleanG === cleanTarget ||
      (normalizedTarget && normG === normalizedTarget) ||
      (cleanStripped && (cleanG === cleanStripped || cleanStrippedG === cleanStripped)) ||
      (normStripped && (normG === normStripped || normStrippedG === normStripped));

    if (isExactMatch) {
      candidates.push({ game: g, score: 85 });
      continue;
    }

    // 3. Suffix match (e.g. Judas 2, Judas Edition)
    const isSuffixMatch =
      cleanG.startsWith(cleanTarget) ||
      (cleanStripped && cleanG.startsWith(cleanStripped)) ||
      (cleanStripped && cleanStrippedG.startsWith(cleanStripped));

    if (isSuffixMatch) {
      const baseClean = cleanG.startsWith(cleanTarget)
        ? cleanTarget
        : cleanStripped;
      const suffix = cleanG.slice(baseClean.length);
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
    if (c.score < 75) continue;
    if (!seenIds.has(c.game.id)) {
      seenIds.add(c.game.id);
      results.push({ ...c.game, _matchScore: c.score });
      if (results.length >= 4) break;
    }
  }

  return results;
}

export class AllKeyShopSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'allkeyshop' as const;
  public readonly name = 'AllKeyShop';
  public readonly supportsBatch = false;

  private cachedCatalog: CatalogGame[] | null = null;
  private catalogIndex: AllKeyShopCatalogIndex | null = null;
  private lastCatalogFetch = 0;
  private pendingCatalogLoad: Promise<CatalogGame[]> | null = null;
  private get catalogPath(): string {
    return path.join(config.dataDir, 'allkeyshop_catalog.json');
  }

  public isEnabled(): boolean {
    return config.allkeyshopEnabled;
  }

  public loadCatalogFromDiskOrMemory(allowSeedFallback = true): CatalogGame[] | null {
    const now = Date.now();
    const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day cache TTL

    // 1. In-memory cache check
    if (this.cachedCatalog && (now - this.lastCatalogFetch) < CATALOG_TTL_MS) {
      if (!this.catalogIndex) {
        this.catalogIndex = new AllKeyShopCatalogIndex(this.cachedCatalog);
      }
      return this.cachedCatalog;
    }

    // 2. Check local disk cache or seed fallbacks
    const candidatePaths = [
      this.catalogPath,
      path.join(config.dataDir, 'aks_catalog_v2.json')
    ];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          const raw = fs.readFileSync(p, 'utf8');
          const data = JSON.parse(raw);
          if (data?.status === 'success' && Array.isArray(data?.games) && data.games.length > 0) {
            if (p !== this.catalogPath && !fs.existsSync(this.catalogPath)) {
              try {
                const dataDir = path.dirname(this.catalogPath);
                if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
                fs.writeFileSync(this.catalogPath, raw, 'utf8');
              } catch {}
            }
            this.cachedCatalog = data.games;
            this.catalogIndex = new AllKeyShopCatalogIndex(data.games);
            this.lastCatalogFetch = stat.mtimeMs || now;
            return this.cachedCatalog;
          }
        }
      } catch {}
    }

    // 3. Fallback to bundled seed catalog (.seed.json.gz) if explicitly allowed
    if (allowSeedFallback) {
      const seedPaths = [
        path.join(process.cwd(), 'src', 'server', 'sources', 'seed', 'allkeyshop_catalog.seed.json.gz'),
        path.resolve(process.cwd(), 'dist', 'server', 'sources', 'seed', 'allkeyshop_catalog.seed.json.gz'),
        path.join(process.cwd(), 'data', 'allkeyshop_catalog.seed.json.gz')
      ];

      for (const sp of seedPaths) {
        try {
          if (fs.existsSync(sp)) {
            const compressed = fs.readFileSync(sp);
            const decompressed = zlib.gunzipSync(compressed).toString('utf8');
            const data = JSON.parse(decompressed);
            if (data?.status === 'success' && Array.isArray(data?.games) && data.games.length > 0) {
              try {
                const dataDir = path.dirname(this.catalogPath);
                if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
                fs.writeFileSync(this.catalogPath, decompressed, 'utf8');
              } catch {}
              this.cachedCatalog = data.games;
              this.catalogIndex = new AllKeyShopCatalogIndex(data.games);
              this.lastCatalogFetch = now;
              return this.cachedCatalog;
            }
          }
        } catch {}
      }
    }

    return null;
  }

  public getCatalogIndex(): AllKeyShopCatalogIndex | null {
    if (!this.catalogIndex && this.cachedCatalog) {
      this.catalogIndex = new AllKeyShopCatalogIndex(this.cachedCatalog);
    }
    return this.catalogIndex;
  }

  public async getCatalogForCandidateSearch(): Promise<CatalogGame[]> {
    // 1. Fast path: check memory or disk (instant, 0ms latency)
    const local = this.loadCatalogFromDiskOrMemory(true);
    if (local && local.length > 0) {
      return local;
    }

    // 2. If solver is not configured, or circuit breaker is not allowed, or queue is cooling down:
    // return cached/empty immediately to never hang the UI
    const cbCheck = circuitBreakers.canExecute('allkeyshop');
    const solverUrl = config.allkeyshopSolverUrl?.trim();
    if (!cbCheck.allowed || !solverUrl || allkeyshopQueue.isCoolingDown) {
      return this.cachedCatalog || [];
    }

    // 3. Remote attempt with strict 6-second timeout
    try {
      return await Promise.race([
        this.ensureCatalogQueued(),
        new Promise<CatalogGame[]>((_, reject) =>
          setTimeout(() => reject(new Error('Candidate search catalog timeout')), 6000)
        )
      ]);
    } catch {
      return this.cachedCatalog || [];
    }
  }

  public async ensureCatalogQueued(): Promise<CatalogGame[]> {
    const local = this.loadCatalogFromDiskOrMemory(false);
    if (local && local.length > 0) {
      return local;
    }

    return allkeyshopQueue.enqueue('__catalog__', () => this.ensureCatalog(), 'Catalog Sync');
  }

  public async ensureCatalog(): Promise<CatalogGame[]> {
    const now = Date.now();
    const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const local = this.loadCatalogFromDiskOrMemory(false);
    if (local && local.length > 0) {
      return local;
    }

    const cbCheck = circuitBreakers.canExecute('allkeyshop');
    if (!cbCheck.allowed) {
      if (this.cachedCatalog) {
        if (!this.catalogIndex) {
          this.catalogIndex = new AllKeyShopCatalogIndex(this.cachedCatalog);
        }
        return this.cachedCatalog;
      }
      throw new AllKeyShopUnavailableError(`AllKeyShop catalog unavailable (${cbCheck.reason || 'source is cooling down'})`);
    }

    if (this.pendingCatalogLoad) {
      return this.pendingCatalogLoad;
    }

    this.pendingCatalogLoad = (async (): Promise<CatalogGame[]> => {

      // 3. Remote download via FlareSolverr/Byparr (Generous 60s timeout for ~11 MB bulk feed)
      const downloadStartTime = Date.now();
      try {
        const url = 'https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&v=2&currency=eur&locales=en_GB';
        const raw = await fetchWithAllkeyshopSolver<unknown>(url, 60000);
        const data = validateAllKeyShopCatalog(raw);

        if (data && data.games.length > 0) {
          this.cachedCatalog = data.games;
          this.catalogIndex = new AllKeyShopCatalogIndex(data.games);
          this.lastCatalogFetch = Date.now();
          const durationSec = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
          console.log(`[AllKeyShop] catalog refreshed | games=${data.games.length} | duration=${durationSec}s`);
          allkeyshopQueue.recordCatalogRefresh();
          circuitBreakers.recordSuccess('allkeyshop');

          try {
            const dataDir = path.dirname(this.catalogPath);
            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
            }
            const tmpPath = `${this.catalogPath}.tmp.${Date.now()}`;
            fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
            fs.renameSync(tmpPath, this.catalogPath);
          } catch (writeErr: any) {
            console.warn('Failed to persist AllKeyShop catalog to disk:', writeErr.message);
          }
          return this.cachedCatalog || [];
        } else {
          console.warn('[AllKeyShop] Catalog response malformed or empty games array.');
          // If we already have a catalog in memory, don't trip circuit breaker for individual price queries
          if (!this.cachedCatalog) {
            circuitBreakers.recordFailure('allkeyshop', 'Catalog response malformed or empty games array');
          }
        }
      } catch (err: any) {
        console.warn('Failed to download AllKeyShop catalog:', err.message);
        const status = err?.status || err?.response?.status || (err?.message?.includes('429') ? 429 : 502);
        const retryAfter = err?.retryAfterSec;
        if (!this.cachedCatalog) {
          if (status === 429) {
            circuitBreakers.recordRateLimit('allkeyshop', retryAfter || 30);
          } else {
            circuitBreakers.recordFailure('allkeyshop', err);
          }
        }
      }

      // 4. Stale fallback from disk if available
      if (!this.cachedCatalog) {
        const fallback = this.loadCatalogFromDiskOrMemory(false);
        if (fallback && fallback.length > 0) {
          const ageHours = Math.round((now - this.lastCatalogFetch) / 3600000);
          console.warn(`[AllKeyShop] using stale catalog cache | age=${ageHours}h`);
          this.cachedCatalog = fallback;
          this.catalogIndex = new AllKeyShopCatalogIndex(fallback);
          this.lastCatalogFetch = now;
        }
      }

      if (this.cachedCatalog) {
        if (!this.catalogIndex) {
          this.catalogIndex = new AllKeyShopCatalogIndex(this.cachedCatalog);
        }
        // Defer next remote catalog fetch attempt by 12 hours so we don't spam solver on every call
        this.lastCatalogFetch = now - CATALOG_TTL_MS + (12 * 60 * 60 * 1000);
        return this.cachedCatalog;
      }
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
    return allkeyshopQueue.enqueue(String(steamAppId), async () => {
      try {
        const catalog = await this.ensureCatalog();
        const searchTarget = this.catalogIndex || catalog;
        const candidates = findCandidateGamesInCatalog(searchTarget, gameTitle, steamAppId, releaseDate);
        if (candidates.length === 0) {
          return [];
        }

        // Probe candidates in priority order and select the one with active offers
        for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
          const matched = candidates[cIdx];
          if (!matched || (!matched.id && !matched.slug)) continue;

          const cbCheck = circuitBreakers.canExecute('allkeyshop');
          if (!cbCheck.allowed || allkeyshopQueue.isCoolingDown) {
            console.warn(`[AllKeyShop] Skipping targeted price lookup for "${gameTitle}": source is cooling down.`);
            return [];
          }

          if (cIdx > 0) {
            await new Promise(r => setTimeout(r, 2000));
          }

          // Build game slug for direct comparison page link
          const cleanSlug = (matched.slug || matched.name || gameTitle)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
          const defaultDealUrl = cleanSlug.startsWith('buy-')
            ? `https://www.allkeyshop.com/blog/${encodeURIComponent(cleanSlug)}/`
            : `https://www.allkeyshop.com/blog/buy-${encodeURIComponent(cleanSlug)}-cd-key-compare-prices/`;

          let offers: NormalizedSourceOffer[] = [];

          // 1. Primary fast path: Direct Numeric API (Deterministic, zero 404s, works for all 204,640 catalog items)
          if (matched.id) {
            const priceApiUrl = buildAksApiUrl('price_history_api.php', {
              normalised_name: matched.id,
              currency: 'EUR',
              database: 'allkeyshop.com',
              v2: '1'
            });

            try {
              const raw = await fetchWithAllkeyshopSolver<unknown>(priceApiUrl, 35000);
              if (raw) {
                const validated = validateAllKeyShopPriceResponse(raw);
                if (validated) {
                  offers = parseAllKeyShopPriceHistory(validated, defaultDealUrl);
                }
              }
            } catch (apiErr: any) {
              if (apiErr?.status === 403 || apiErr?.status === 429) {
                throw apiErr;
              }
              console.warn(`[AllKeyShop] Direct API lookup failed for "${gameTitle}" (${apiErr?.message || apiErr}), attempting HTML page fallback`);
            }
          }

          // 2. Secondary fallback: Live Comparison Page if API had no offers or game had no numeric id
          if (offers.length === 0) {
            try {
              const pageResponse = await fetchWithAllkeyshopSolver<unknown>(defaultDealUrl, 35000);
              if (typeof pageResponse === 'string' && pageResponse.includes('gamePageTrans')) {
                offers = parseAllKeyShopGamePage(pageResponse, defaultDealUrl);
              }
            } catch (pageErr: any) {
              if (pageErr?.status === 403 || pageErr?.status === 429) {
                throw pageErr;
              }
              console.warn(`[AllKeyShop] HTML page lookup failed for "${gameTitle}" (${pageErr?.message || pageErr})`);
            }
          }

          offers = offers.filter(o => !isNaN(o.priceEur) && o.priceEur > 0.05);

          if (offers.length > 0) {
            const matchScore = matched._matchScore;
            if (typeof matchScore === 'number' && matchScore < 85) {
              console.warn(`[AllKeyShop] Low-confidence title match used for "${gameTitle}" -> "${matched.name}" (id=${matched.id}, score=${matchScore}). Verify with allkeyshop_mapping.json if incorrect.`);
            }
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
    }, gameTitle);
  }
}

export const allkeyshopAdapter = new AllKeyShopSourceAdapter();
