import { config } from '../config/index.js';
import { safeFetchJson, type PriceSourceAdapter, type NormalizedSourceOffer } from './base.js';
import { PacedSourceQueue } from '../sync/rateLimiter.js';
import { circuitBreakers } from '../sync/circuitBreaker.js';
import { convertToEur, normalizeRegion, normalizeProductType } from '../domain/normalizer.js';
import { logInfo, logWarn } from '../utils/logger.js';

interface SdbApiOffer {
  store: string;
  store_name: string;
  store_type: 'official' | 'retailer' | 'marketplace' | string;
  price: number;
  drm?: string | null;
  region?: string | null;
  checked_at?: string | null;
  discount_pct?: number | null;
}

interface SdbApiGameResult {
  id: string;
  name: string;
  steam_app_id: number | null;
  url: string;
  currency: string;
  list_price?: number;
  lowest?: SdbApiOffer & { discount_pct?: number };
  lowest_steam_key?: SdbApiOffer;
  store_count?: number;
  offer_count?: number;
  offers?: SdbApiOffer[];
}

interface SdbLookupResponse {
  api: string;
  query?: Record<string, unknown>;
  count?: number;
  results?: SdbApiGameResult[];
  error?: string;
}

export class SuperDuperBundleSourceAdapter implements PriceSourceAdapter {
  public readonly code = 'superduperbundle' as const;
  public readonly name = 'SuperDuperBundle';
  public readonly supportsBatch = true;
  private queue = new PacedSourceQueue('superduperbundle', config.delays.superduperbundle || 1000, 200);

  public clearQueue(): void {
    this.queue.reset();
  }

  public isEnabled(): boolean {
    return Boolean(config.superduperbundleEnabled);
  }

  private getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'PriceSteamTool/2.8 (+https://github.com/pricesteamtool)'
    };
    if (config.superduperbundleApiKey?.trim()) {
      headers['X-API-Key'] = config.superduperbundleApiKey.trim();
    }
    return headers;
  }

  /**
   * Normalize an SDB offer into PriceSteamTool's canonical representation
   */
  private normalizeOffer(offer: SdbApiOffer, fallbackUrl: string): NormalizedSourceOffer | null {
    if (typeof offer.price !== 'number' || isNaN(offer.price) || offer.price <= 0) {
      return null;
    }

    const priceEur = convertToEur(offer.price, 'USD');
    if (isNaN(priceEur) || priceEur <= 0.05) {
      return null;
    }

    const isOfficial = offer.store_type === 'official' || offer.store_type === 'retailer';
    const merchantCode = (offer.store || offer.store_name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');

    const normProduct = normalizeProductType(offer.drm || 'Steam', offer.store_name || offer.store);
    if (!normProduct.isValid) {
      return null;
    }

    const normRegion = normalizeRegion(offer.region || 'Global');
    if (!normRegion.isValid) {
      return null;
    }

    return {
      merchantCode: merchantCode || 'sdb-store',
      merchantName: offer.store_name || offer.store,
      isOfficial,
      priceEur,
      rawPrice: offer.price,
      rawCurrency: 'USD',
      dealUrl: fallbackUrl,
      productTypeRaw: normProduct.productType,
      regionRaw: normRegion.regionCode,
      rawPayload: offer
    };
  }

  /**
   * Fetch prices for a single game by Steam App ID
   */
  public async fetchPricesForGame(
    steamAppId: number,
    gameTitle: string
  ): Promise<NormalizedSourceOffer[]> {
    if (!this.isEnabled()) {
      return [];
    }

    const cbCheck = circuitBreakers.canExecute('superduperbundle');
    if (!cbCheck.allowed) {
      logWarn(`[SuperDuperBundle] Circuit open/cooling down, skipping lookup for "${gameTitle}" (${steamAppId}).`);
      return [];
    }

    return this.queue.enqueue(async () => {
      try {
        const url = `https://superduperbundle.com/api/v1/lookup/?steam_id=${steamAppId}&client=pricetool`;
        const res = await safeFetchJson<SdbLookupResponse>(url, {
          headers: this.getRequestHeaders()
        }, 10000);

        circuitBreakers.recordSuccess('superduperbundle');

        const gameResult = res?.results?.[0];
        if (!gameResult || !gameResult.offers || gameResult.offers.length === 0) {
          return [];
        }

        const offers: NormalizedSourceOffer[] = [];
        const dealPageUrl = gameResult.url || `https://superduperbundle.com/game/${gameResult.id}/`;

        for (const rawOffer of gameResult.offers) {
          const norm = this.normalizeOffer(rawOffer, dealPageUrl);
          if (norm) {
            offers.push(norm);
          }
        }

        return offers;
      } catch (err: any) {
        if (err?.status === 429 || err?.retryAfterSec) {
          circuitBreakers.recordRateLimit('superduperbundle', err.retryAfterSec || 30);
        } else {
          circuitBreakers.recordFailure('superduperbundle', err.message);
        }
        logWarn(`[SuperDuperBundle] Lookup failed for "${gameTitle}" (${steamAppId}): ${err.message}`);
        return [];
      }
    });
  }

  /**
   * High-speed batch lookup for up to 50 Steam App IDs per request with resilient chunk handling
   */
  public async fetchBatchPrices(
    games: { steamAppId: number; title: string; itadId?: string }[],
    onProgress?: (processed: number, total: number, action?: string) => void
  ): Promise<Map<number, NormalizedSourceOffer[]>> {
    const resultMap = new Map<number, NormalizedSourceOffer[]>();

    if (!this.isEnabled() || games.length === 0) {
      return resultMap;
    }

    const validGames = games.filter(g => g.steamAppId && !isNaN(g.steamAppId));
    const CHUNK_SIZE = 50; // SDB API supports up to 50 steam_ids per request
    const chunks: { steamAppId: number; title: string }[][] = [];

    for (let i = 0; i < validGames.length; i += CHUNK_SIZE) {
      chunks.push(validGames.slice(i, i + CHUNK_SIZE));
    }

    let processedCount = 0;
    let failedChunks = 0;

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];

      // Periodic breathing pause every 10 chunks (500 games) to respect 600-game / 10-minute rate limit window
      if (chunkIdx > 0 && chunkIdx % 10 === 0) {
        const pauseMs = process.env.NODE_ENV === 'test' ? 0 : (config.superduperbundleChunkPauseMs || 2500);
        if (pauseMs > 0) {
          await new Promise(r => setTimeout(r, pauseMs));
        }
      }

      // Check circuit breaker status
      if (circuitBreakers.isCoolingDown('superduperbundle')) {
        const remainingSec = circuitBreakers.getRemainingCooldownSec('superduperbundle');
        if (remainingSec <= 30 && process.env.NODE_ENV !== 'test') {
          logWarn(`[SuperDuperBundle] Cooldown active (${remainingSec}s remaining). Waiting for rate limit reset...`);
          await new Promise(r => setTimeout(r, (remainingSec + 1) * 1000));
        } else {
          logWarn(`[SuperDuperBundle] Skipping chunk ${chunkIdx + 1}/${chunks.length} due to active cooldown (${remainingSec}s remaining).`);
          failedChunks++;
          processedCount += chunk.length;
          if (onProgress) {
            onProgress(
              Math.min(processedCount, validGames.length),
              validGames.length,
              `SuperDuperBundle: ${Math.min(processedCount, validGames.length)}/${validGames.length} games (cooldown active)...`
            );
          }
          continue;
        }
      }

      let chunkSucceeded = false;
      const maxAttempts = 2;

      for (let attempt = 0; attempt < maxAttempts && !chunkSucceeded; attempt++) {
        await this.queue.enqueue(async () => {
          try {
            const steamIds = chunk.map(g => g.steamAppId).join(',');
            const url = `https://superduperbundle.com/api/v1/lookup/?steam_ids=${steamIds}&client=pricetool`;

            const res = await safeFetchJson<SdbLookupResponse>(url, {
              headers: this.getRequestHeaders()
            }, 15000);

            circuitBreakers.recordSuccess('superduperbundle');
            chunkSucceeded = true;

            if (res?.results && Array.isArray(res.results)) {
              for (const item of res.results) {
                if (!item.steam_app_id || !item.offers) continue;
                const offers: NormalizedSourceOffer[] = [];
                const dealPageUrl = item.url || `https://superduperbundle.com/game/${item.id}/`;

                for (const rawOffer of item.offers) {
                  const norm = this.normalizeOffer(rawOffer, dealPageUrl);
                  if (norm) {
                    offers.push(norm);
                  }
                }

                if (offers.length > 0) {
                  resultMap.set(item.steam_app_id, offers);
                }
              }
            }
          } catch (err: any) {
            if (err?.status === 429 || err?.retryAfterSec) {
              const retryAfter = err.retryAfterSec || 30;
              circuitBreakers.recordRateLimit('superduperbundle', retryAfter, chunk.length);
              logWarn(`[SuperDuperBundle] Rate limit (429) on chunk ${chunkIdx + 1}/${chunks.length}. Backoff set for ${retryAfter}s.`);
            } else {
              circuitBreakers.recordFailure('superduperbundle', err.message);
              logWarn(`[SuperDuperBundle] Batch chunk ${chunkIdx + 1}/${chunks.length} attempt ${attempt + 1}/${maxAttempts} failed: ${err.message}`);
            }

            if (attempt + 1 < maxAttempts) {
              const backoffMs = process.env.NODE_ENV === 'test' ? 10 : 1500;
              await new Promise(r => setTimeout(r, backoffMs));
            }
          }
        });
      }

      if (!chunkSucceeded) {
        failedChunks++;
      }

      processedCount += chunk.length;
      if (onProgress) {
        onProgress(
          Math.min(processedCount, validGames.length),
          validGames.length,
          `SuperDuperBundle: processed ${Math.min(processedCount, validGames.length)}/${validGames.length} games`
        );
      }
    }

    (resultMap as any).failedChunks = failedChunks;
    return resultMap;
  }
}

export const superDuperBundleAdapter = new SuperDuperBundleSourceAdapter();
