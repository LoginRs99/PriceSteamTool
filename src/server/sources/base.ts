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
  editionName?: string;
  metacriticScore?: number;
  metacriticUrl?: string;
  /**
   * v2.4.0 (ADR-1): set by a source adapter when it has multiple internal
   * sub-categories for the same game (e.g. GG.deals "Official" vs
   * "Keyshops") and they disagree beyond SOURCE_FAMILY_CONFLICT_RATIO.
   * See detectSourceFamilyConflict() in domain/pricingError/detector.ts.
   */
  sourceFamilyConflict?: { ratio: number; details: string };
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
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < 0) return undefined;
    // If val is a Unix epoch timestamp in seconds (e.g. > 1e9), calculate remaining seconds
    if (val > 1_000_000_000) {
      const diffSecs = Math.ceil(val - (Date.now() / 1000));
      return Math.max(0, diffSecs);
    }
    return val;
  }
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    const diffSecs = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSecs > 0 ? diffSecs : 0;
  }
  return undefined;
}

async function sleepBackoff(attempt: number): Promise<void> {
  const baseDelay = attempt === 1 ? 500 : 1500;
  const jitter = Math.floor(Math.random() * 200);
  await new Promise(r => setTimeout(r, baseDelay + jitter));
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
    if (options.signal?.aborted) {
      const abortErr: any = new Error('This operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
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

      const combinedSignal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;

      const response = await fetch(url, {
        ...options,
        headers,
        signal: combinedSignal,
      });

      if (!response) {
        throw new Error(`No response received for ${url}`);
      }

      if (!response.ok) {
        let responseBodyText = '';
        try {
          if (typeof response.text === 'function') {
            responseBodyText = await response.text();
          }
        } catch {}

        let detailMsg = '';
        if (responseBodyText) {
          try {
            const parsed = JSON.parse(responseBodyText);
            const detail = parsed?.reason_phrase || parsed?.error || parsed?.message || parsed?.detail;
            if (detail) detailMsg = ` - ${detail}`;
          } catch {
            const snippet = responseBodyText.slice(0, 160).replace(/\s+/g, ' ').trim();
            if (snippet) detailMsg = ` - ${snippet}`;
          }
        }

        const error: any = new Error(`HTTP ${response.status} ${response.statusText} for ${url}${detailMsg}`);
        error.status = response.status;
        error.body = responseBodyText;
        const headersDict = Object.fromEntries(response.headers.entries());
        error.headers = headersDict;

        const retryAfterRaw = response.headers.get('retry-after') 
          || headersDict['retry-after']
          || response.headers.get('x-ratelimit-reset')
          || headersDict['x-ratelimit-reset']
          || response.headers.get('ratelimit-reset')
          || headersDict['ratelimit-reset'];
        const retryAfterSec = parseRetryAfterHeader(retryAfterRaw);
        if (retryAfterSec !== undefined) {
          error.retryAfterSec = retryAfterSec;
        }

        const isTransientStatus = [408, 502, 503, 504].includes(response.status);
        if (!isTransientStatus || attempt === maxAttempts) {
          throw error;
        }

        lastError = error;
        await sleepBackoff(attempt);
      } else {
        let parsedData: T;
        if (typeof response.text === 'function') {
          const rawText = await response.text();
          try {
            parsedData = JSON.parse(rawText) as T;
          } catch (jsonErr: any) {
            const contentType = response.headers?.get?.('content-type') || 'unknown';
            const preview = rawText.slice(0, 160).replace(/\s+/g, ' ').trim();
            const parseError: any = new Error(
              `Failed to parse JSON response from ${url} (status: ${response.status}, content-type: ${contentType}): ${preview}`
            );
            parseError.status = response.status;
            parseError.rawText = rawText;
            throw parseError;
          }
        } else {
          parsedData = (await response.json()) as T;
        }

        if (parsedData && (typeof parsedData === 'object' || Array.isArray(parsedData))) {
          try {
            Object.defineProperty(parsedData, '_headers', {
              value: response.headers,
              enumerable: false,
              writable: true,
              configurable: true
            });
          } catch {}
        }
        return parsedData;
      }
    } catch (err: any) {
      lastError = err;
      if (options.signal?.aborted) {
        throw err;
      }
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

      await sleepBackoff(attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
