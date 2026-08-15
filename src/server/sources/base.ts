import type { SourceCode } from '../../shared/types.js';

export interface NormalizedSourceOffer {
  merchantCode: string;
  merchantName: string;
  isOfficial: boolean;
  productTypeRaw?: string;
  regionRaw?: string;
  priceEur: number;
  originalPriceEur?: number;
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
    itadId?: string
  ): Promise<NormalizedSourceOffer[]>;

  fetchBatchPrices?(
    games: { steamAppId: number; title: string; itadId?: string }[]
  ): Promise<Map<number, NormalizedSourceOffer[]>>;
}

/**
 * Standard fetch helper with timeout and custom User-Agent
 */
export async function safeFetchJson<T>(
  url: string, 
  options: RequestInit = {}, 
  timeoutMs: number = 10000
): Promise<T> {
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
      error.headers = Object.fromEntries(response.headers.entries());
      throw error;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
