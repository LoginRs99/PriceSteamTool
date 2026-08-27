import type { SourceCode } from '../../shared/types.js';

export interface NormalizedSourceOffer {
  merchantCode: string;
  merchantName: string;
  isOfficial: boolean;
  productTypeRaw?: string;
  regionRaw?: string;
  priceEur: number;
  originalPriceEur?: number;
  rawPrice?: number;
  rawCurrency?: string;
  rawOriginalPrice?: number;
  voucherCode?: string;
  dealUrl: string;
  historicalLowEur?: number;
  historicalLowDate?: string;
  rawPayload?: any;
}

export interface PriceSourceAdapter {
  readonly code: SourceCode;
  readonly name: string;
  readonly supportsBatch: boolean;

  isEnabled(): boolean;
  
  fetchPricesForGame(
    steamAppId: number, 
    gameTitle: string, 
    itadId?: string,
    releaseDate?: string
  ): Promise<NormalizedSourceOffer[]>;

  fetchBatchPrices?(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>>;
}

/**
 * Parses HTTP Retry-After header value into integer seconds.
 * Handles both integer seconds ("30") and HTTP-date ("Thu, 27 Aug 2026 09:30:00 GMT").
 */
export function parseRetryAfterHeader(headerValue?: string | null): number | undefined {
  if (!headerValue || typeof headerValue !== 'string') return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = parseInt(trimmed, 10);
    return isNaN(secs) || secs < 0 ? undefined : secs;
  }
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    const diffSecs = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSecs > 0 ? diffSecs : 0;
  }
  return undefined;
}

/**
 * Standard fetch helper with timeout, custom User-Agent, and generic transient retry (max 2 retries)
 */
export async function safeFetchJson<T>(
  url: string, 
  options: RequestInit = {}, 
  timeoutMs: number = 10000
): Promise<T> {
  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = new Headers(options.headers || {});
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', 'Pricetool-SteamAggregator/1.0 (self-hosted; +https://github.com/pricetool)');
      }
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json, text/plain, */*');
      }

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error: any = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        error.status = response.status;
        const headersDict = Object.fromEntries(response.headers.entries());
        error.headers = headersDict;

        const retryAfterRaw = response.headers.get('retry-after') || headersDict['retry-after'];
        const retryAfterSec = parseRetryAfterHeader(retryAfterRaw);
        if (retryAfterSec !== undefined) {
          error.retryAfterSec = retryAfterSec;
        }

        const isTransientStatus = [408, 502, 503, 504].includes(response.status);
        if (!isTransientStatus || attempt === maxAttempts) {
          throw error;
        }

        lastError = error;
      } else {
        return (await response.json()) as T;
      }
    } catch (err: any) {
      lastError = err;
      const isTransientErr = 
        err?.status === 408 || 
        err?.status === 502 || 
        err?.status === 503 || 
        err?.status === 504 || 
        err?.name === 'AbortError' || 
        err?.code === 'ECONNRESET' || 
        err?.code === 'ETIMEDOUT' || 
        err?.message?.includes('fetch failed');

      if (!isTransientErr || attempt === maxAttempts) {
        throw err;
      }

      const baseDelay = attempt === 1 ? 500 : 1500;
      const jitter = Math.floor(Math.random() * 200);
      await new Promise(r => setTimeout(r, baseDelay + jitter));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
