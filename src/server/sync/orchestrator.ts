import { randomUUID } from 'crypto';
import { 
  profileRepo, 
  gameRepo, 
  merchantRepo, 
  offerRepo, 
  sourceRepo, 
  anomalyRepo 
} from '../db/index.js';
import { config } from '../config/index.js';
import { steamAdapter } from '../sources/steam.js';
import { itadAdapter } from '../sources/itad.js';
import { ggdealsAdapter } from '../sources/ggdeals.js';
import { cheapsharkAdapter } from '../sources/cheapshark.js';
import { allkeyshopAdapter } from '../sources/allkeyshop.js';
import { gocdkeysAdapter } from '../sources/gocdkeys.js';
import { 
  normalizeProductType, 
  normalizeRegion,
  type NormalizedProduct, 
  type NormalizedRegion 
} from '../domain/normalizer.js';
import { evaluateOfferAnomaly } from '../domain/anomaly.js';
import { circuitBreakers } from './circuitBreaker.js';
import { logInfo, logWarn, logError, logSummaryReport } from '../utils/logger.js';
import type { 
  SyncProgressUpdate, 
  SourceCode
} from '../../shared/types.js';
import type { NormalizedSourceOffer, PriceSourceAdapter } from '../sources/base.js';

type SseCallback = (data: SyncProgressUpdate) => void;

export class SyncOrchestrator {
  private sseClients = new Set<SseCallback>();
  private activeRunId: string | null = null;
  private isCancelled = false;
  private startTime = 0;
  private progress: SyncProgressUpdate = {
    runId: '',
    status: 'IDLE',
    totalGames: 0,
    processedGames: 0,
    currentAction: 'Idle',
    sourceProgress: {
      steam: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' },
      itad: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' },
      ggdeals: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' },
      cheapshark: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' },
      allkeyshop: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' },
      gocdkeys: { total: 0, processed: 0, offersFound: 0, state: 'NORMAL' }
    }
  };

  public subscribe(cb: SseCallback): () => void {
    this.sseClients.add(cb);
    cb(this.getProgress());
    return () => this.sseClients.delete(cb);
  }

  private broadcast(): void {
    for (const client of this.sseClients) {
      try {
        client(this.getProgress());
      } catch (e) {
        this.sseClients.delete(client);
      }
    }
  }

  public getProgress(): SyncProgressUpdate {
    for (const code of Object.keys(this.progress.sourceProgress) as SourceCode[]) {
      this.progress.sourceProgress[code].state = circuitBreakers.getState(code);
    }
    return { ...this.progress };
  }

  public isSyncRunning(): boolean {
    return this.progress.status === 'RUNNING';
  }

  public cancelSync(): void {
    if (this.progress.status === 'RUNNING') {
      this.isCancelled = true;
      this.progress.status = 'CANCELLED';
      this.progress.currentAction = 'Sync cancelled by user';
      logWarn(`Sync run ${this.activeRunId} cancelled by user.`);
      this.broadcast();
    }
  }

  public async startSync(
    profileId?: string, 
    forceRefresh: boolean = false, 
    selectedSources?: SourceCode[],
    trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL'
  ): Promise<SyncProgressUpdate> {
    if (this.progress.status === 'RUNNING') {
      return this.getProgress();
    }

    const targetProfile = profileId 
      ? profileRepo.list().find(p => p.id === profileId) 
      : profileRepo.getActive();

    if (!targetProfile) {
      throw new Error('No active Steam profile configured. Please add or select a Steam profile first.');
    }

    const runId = randomUUID();
    this.activeRunId = runId;
    this.isCancelled = false;
    this.startTime = Date.now();

    this.progress = {
      runId,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      totalGames: 0,
      processedGames: 0,
      currentAction: `Fetching Steam Wishlist for ${targetProfile.name}...`,
      sourceProgress: {
        steam: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('steam') },
        itad: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('itad') },
        ggdeals: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('ggdeals') },
        cheapshark: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('cheapshark') },
        allkeyshop: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('allkeyshop') },
        gocdkeys: { total: 0, processed: 0, offersFound: 0, state: circuitBreakers.getState('gocdkeys') }
      }
    };
    this.broadcast();

    logInfo(`Starting sync run [${runId}] (${trigger}) for profile "${targetProfile.name}" (${targetProfile.steamId})`, {
      forceRefresh,
      selectedSources: selectedSources || 'ALL_ENABLED'
    });

    // Run execution in background so HTTP response is returned immediately
    this.runSyncPipeline(targetProfile.id, targetProfile.steamId, targetProfile.name, forceRefresh, selectedSources, trigger).catch(err => {
      logError(`Sync pipeline ${runId} encountered an error:`, err);
      this.progress.status = 'FAILED';
      this.progress.currentAction = `Error: ${err.message || 'Sync failed'}`;
      this.broadcast();
    });

    return this.getProgress();
  }

  private async runSyncPipeline(
    profileId: string, 
    steamId: string, 
    profileName: string,
    forceRefresh: boolean, 
    selectedSources?: SourceCode[],
    trigger: string = 'MANUAL'
  ): Promise<void> {
    const activeSourcesList = sourceRepo.list();
    const shouldRunSource = (code: SourceCode) => {
      if (selectedSources && selectedSources.length > 0) {
        return selectedSources.includes(code);
      }
      const found = activeSourcesList.find(s => s.code === code);
      return Boolean(found?.isEnabled);
    };

    let totalWishlistCount = 0;
    let staleQueriedCount = 0;
    let totalOffersIngested = 0;

    try {
      // Step 1: Ingest Steam Wishlist
      this.progress.currentAction = 'Fetching Wishlist from Steam API...';
      this.broadcast();

      const wishlistItems = await steamAdapter.fetchWishlist(steamId);
      if (this.isCancelled) return;

      totalWishlistCount = wishlistItems.length;

      if (wishlistItems.length === 0) {
        this.progress.currentAction = 'Wishlist is empty or profile is private.';
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.broadcast();
        logWarn(`Wishlist for ${steamId} returned 0 items. Ensure game details are Public.`);
        return;
      }

      this.progress.totalGames = wishlistItems.length;
      this.progress.currentAction = `Discovered ${wishlistItems.length} games. Resolving metadata...`;
      this.broadcast();

      logInfo(`Ingested ${wishlistItems.length} wishlist entries from Steam API.`);

      // Step 2: Ingest games and sync wishlist entries in SQLite with batch metadata
      gameRepo.syncWishlistEntries(profileId, wishlistItems);

      // Step 3: If Steam source is active, record store offers directly from batch metadata
      const allWishlistGames = gameRepo.getAllWishlistGameIds(profileId);
      if (shouldRunSource('steam')) {
        this.progress.currentAction = 'Processing Steam Store prices...';
        this.progress.sourceProgress.steam.total = wishlistItems.length;
        this.broadcast();

        for (const item of wishlistItems) {
          if (this.isCancelled) return;
          if (item.currentPriceEur !== undefined) {
            const game = allWishlistGames.find(g => g.steamAppId === item.steamAppId);
            if (game) {
              this.ingestOffer(game.id, 'steam', {
                merchantCode: 'steam',
                merchantName: 'Steam Store',
                isOfficial: true,
                productTypeRaw: 'DIRECT_PURCHASE',
                regionRaw: 'GLOBAL',
                priceEur: item.currentPriceEur,
                originalPriceEur: item.basePriceEur,
                rawPrice: item.rawPrice,
                rawCurrency: item.rawCurrency,
                rawOriginalPrice: item.rawOriginalPrice,
                dealUrl: `https://store.steampowered.com/app/${item.steamAppId}/`
              }, item.basePriceEur);
              this.progress.sourceProgress.steam.offersFound++;
              totalOffersIngested++;
            }
          }
          this.progress.sourceProgress.steam.processed++;
        }

        // Check if any games still need fallback individual AppDetails (e.g. title starts with 'App ')
        const gamesNeedingFallback = allWishlistGames.filter(g => g.title.startsWith('App '));
        if (gamesNeedingFallback.length > 0) {
          this.progress.currentAction = `Resolving fallback metadata for ${gamesNeedingFallback.length} items...`;
          this.broadcast();

          for (const g of gamesNeedingFallback) {
            if (this.isCancelled) return;
            try {
              const details = await steamAdapter.fetchAppDetails(g.steamAppId);
              if (details) {
                const updatedGame = gameRepo.upsert({
                  steamAppId: g.steamAppId,
                  title: details.title,
                  headerImage: details.headerImage,
                  capsuleImage: details.capsuleImage,
                  releaseDate: details.releaseDate,
                  isDlc: details.isDlc,
                  isFree: details.isFree,
                  basePriceEur: details.basePriceEur
                });
                g.title = updatedGame.title;

                if (details.currentPriceEur !== undefined) {
                  this.ingestOffer(updatedGame.id, 'steam', {
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
                    dealUrl: `https://store.steampowered.com/app/${g.steamAppId}/`
                  }, updatedGame.basePriceEur);
                  this.progress.sourceProgress.steam.offersFound++;
                  totalOffersIngested++;
                }
              }
            } catch (e) {
              // Ignore fallback error
            }
          }
        }
      }

      // Step 4: Determine which games require price refreshes (Cache-First TTL Strategy)
      const gamesToRefresh = forceRefresh 
        ? allWishlistGames 
        : gameRepo.getStaleWishlistGameIds(profileId, config.cacheTtlHours);

      staleQueriedCount = gamesToRefresh.length;
      const cacheHitRatio = totalWishlistCount > 0 
        ? Math.max(0, ((totalWishlistCount - staleQueriedCount) / totalWishlistCount) * 100) 
        : 100;

      if (gamesToRefresh.length === 0) {
        const duration = Math.round((Date.now() - this.startTime) / 1000);
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.progress.currentAction = `Wishlist is up to date (cached). No stale items to refresh.`;
        this.broadcast();

        this.generateSummary(profileName, steamId, trigger, 'COMPLETED', duration, totalWishlistCount, 0, 100, totalOffersIngested, selectedSources);
        return;
      }

      this.progress.currentAction = `Found ${gamesToRefresh.length} items needing price refresh...`;
      this.broadcast();

      logInfo(`Refreshing prices for ${gamesToRefresh.length} games (Cache hit ratio: ${cacheHitRatio.toFixed(1)}%)`);

      // Step 5: High-Speed Parallel Batch Sync (ITAD, CheapShark, GG.deals)
      const batchTasks: Promise<void>[] = [];

      // ITAD Batch Sync
      if (shouldRunSource('itad') && !this.isCancelled) {
        this.progress.sourceProgress.itad.total = gamesToRefresh.length;
        batchTasks.push((async () => {
          try {
            const itadBatchResults = await itadAdapter.fetchBatchPrices(
              gamesToRefresh,
              (processed, total, action) => {
                if (this.isCancelled) return;
                this.progress.sourceProgress.itad.processed = processed;
                this.progress.sourceProgress.itad.total = total;
                if (action) this.progress.currentAction = action;
                this.broadcast();
              }
            );

            for (const [appId, offers] of itadBatchResults.entries()) {
              const game = gamesToRefresh.find(w => w.steamAppId === appId);
              if (!game) continue;
              for (const offer of offers) {
                this.ingestOffer(game.id, 'itad', offer);
                this.progress.sourceProgress.itad.offersFound++;
                totalOffersIngested++;
              }
            }
            this.progress.sourceProgress.itad.processed = gamesToRefresh.length;
            this.broadcast();
          } catch (e: any) {
            logWarn(`ITAD batch sync warning: ${e?.message}`);
          }
        })());
      }

      // CheapShark Batch Sync (High-Speed Free Public Batch API)
      if (shouldRunSource('cheapshark') && !this.isCancelled) {
        this.progress.sourceProgress.cheapshark.total = gamesToRefresh.length;
        batchTasks.push((async () => {
          try {
            const csBatchResults = await cheapsharkAdapter.fetchBatchPrices(
              gamesToRefresh,
              (processed, total, action) => {
                if (this.isCancelled) return;
                this.progress.sourceProgress.cheapshark.processed = processed;
                this.progress.sourceProgress.cheapshark.total = total;
                if (action) this.progress.currentAction = action;
                this.broadcast();
              }
            );

            for (const [appId, offers] of csBatchResults.entries()) {
              const game = gamesToRefresh.find(w => w.steamAppId === appId);
              if (!game) continue;
              for (const offer of offers) {
                this.ingestOffer(game.id, 'cheapshark', offer);
                this.progress.sourceProgress.cheapshark.offersFound++;
                totalOffersIngested++;
              }
            }
            this.progress.sourceProgress.cheapshark.processed = gamesToRefresh.length;
            this.broadcast();
          } catch (e: any) {
            logWarn(`CheapShark batch sync warning: ${e?.message}`);
          }
        })());
      }

      // GG.deals Batch Sync (if enabled & API key configured)
      if (shouldRunSource('ggdeals') && !this.isCancelled && config.ggdealsApiKey) {
        this.progress.sourceProgress.ggdeals.total = gamesToRefresh.length;
        batchTasks.push((async () => {
          try {
            const ggBatchResults = await ggdealsAdapter.fetchBatchPrices(gamesToRefresh);
            for (const [appId, offers] of ggBatchResults.entries()) {
              const game = gamesToRefresh.find(w => w.steamAppId === appId);
              if (!game) continue;
              for (const offer of offers) {
                this.ingestOffer(game.id, 'ggdeals', offer);
                this.progress.sourceProgress.ggdeals.offersFound++;
                totalOffersIngested++;
              }
              this.progress.sourceProgress.ggdeals.processed++;
            }
            this.progress.sourceProgress.ggdeals.processed = gamesToRefresh.length;
            this.broadcast();
          } catch (e: any) {
            logWarn(`GG.deals batch sync warning: ${e?.message}`);
          }
        })());
      }

      // Execute all batch sources concurrently in parallel
      if (batchTasks.length > 0) {
        this.progress.currentAction = `Simultaneously querying official stores via parallel batch APIs...`;
        this.broadcast();
        await Promise.allSettled(batchTasks);
      }

      // Step 6: Smart Prioritized Non-Batch Secondary Sources (AllKeyShop, GoCDKeys)
      const secondaryAdapters: PriceSourceAdapter[] = [];
      if (shouldRunSource('allkeyshop')) secondaryAdapters.push(allkeyshopAdapter);
      if (shouldRunSource('gocdkeys')) secondaryAdapters.push(gocdkeysAdapter);

      if (secondaryAdapters.length > 0 && !this.isCancelled) {
        // Full wishlist coverage by default (0 = all games), or capped if configured
        const maxGames = config.allkeyshopMaxGames;
        const prioritizedGames = (maxGames > 0 && maxGames < gamesToRefresh.length) 
          ? gamesToRefresh.slice(0, maxGames) 
          : gamesToRefresh;

        for (const adapter of secondaryAdapters) {
          this.progress.sourceProgress[adapter.code].total = prioritizedGames.length;
        }
        this.broadcast();

        const chunkSize = config.allkeyshopChunkSize;
        const pauseMs = config.allkeyshopChunkPauseMs;

        for (let i = 0; i < prioritizedGames.length; i++) {
          if (this.isCancelled) return;
          const g = prioritizedGames[i];
          this.progress.processedGames = i + 1;
          this.progress.currentAction = `Querying keyshops: [${i + 1}/${prioritizedGames.length}] ${g.title}`;

          await Promise.allSettled(
            secondaryAdapters.map(async (adapter) => {
              try {
                const offers = await adapter.fetchPricesForGame(g.steamAppId, g.title, g.itadId);
                for (const offer of offers) {
                  this.ingestOffer(g.id, adapter.code, offer);
                  this.progress.sourceProgress[adapter.code].offersFound++;
                  totalOffersIngested++;
                }
              } catch {
                // Ignore individual scraping errors
              } finally {
                this.progress.sourceProgress[adapter.code].processed++;
              }
            })
          );

          if (i % 5 === 0 || i === prioritizedGames.length - 1) {
            this.broadcast();
          }

          // Anti-ban Cooldown Break: every `chunkSize` games (if more games remain)
          const isChunkEnd = (i + 1) % chunkSize === 0 && (i + 1) < prioritizedGames.length;
          if (isChunkEnd && !this.isCancelled) {
            const pauseSeconds = Math.round(pauseMs / 1000);
            logInfo(`[Keyshops] Completed chunk of ${chunkSize} games (${i + 1}/${prioritizedGames.length}). Taking a ${pauseSeconds}s anti-ban cooldown break.`);
            
            // Countdown loop with cancel checking every second
            for (let sec = pauseSeconds; sec > 0; sec--) {
              if (this.isCancelled) return;
              this.progress.currentAction = `[AllKeyShop] Firewall-protection cooldown break (${sec}s) [${i + 1}/${prioritizedGames.length}]...`;
              this.broadcast();
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        }
      }

      // Finalize
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.progress.status = 'COMPLETED';
      this.progress.completedAt = new Date().toISOString();
      this.progress.currentAction = `Sync completed! Refreshed ${gamesToRefresh.length} games.`;
      this.broadcast();

      this.generateSummary(profileName, steamId, trigger, 'COMPLETED', duration, totalWishlistCount, staleQueriedCount, cacheHitRatio, totalOffersIngested, selectedSources);

    } catch (err: any) {
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.progress.status = 'FAILED';
      this.progress.currentAction = `Sync failed: ${err.message || 'Unknown error'}`;
      this.broadcast();

      this.generateSummary(profileName, steamId, trigger, 'FAILED', duration, totalWishlistCount, staleQueriedCount, 0, totalOffersIngested, selectedSources);
      throw err;
    }
  }

  private generateSummary(
    profileName: string, 
    steamId: string, 
    trigger: string, 
    status: string, 
    durationSec: number,
    totalWishlist: number,
    staleQueried: number,
    cacheHitPercent: number,
    offersUpdated: number,
    selectedSources?: SourceCode[]
  ): void {
    const currentSources = sourceRepo.list();
    const sourceStats: Record<string, any> = {};

    for (const s of currentSources) {
      sourceStats[s.name] = {
        requests: s.requestCount,
        success: s.successCount,
        failures: s.failureCount,
        rateLimits: s.rateLimitCount,
        state: circuitBreakers.getState(s.code)
      };
    }

    logSummaryReport({
      runId: this.activeRunId || 'N/A',
      trigger,
      profileName,
      steamId,
      status,
      durationSec,
      totalWishlist,
      staleQueried,
      cacheHitPercent,
      offersUpdated,
      selectedSources: selectedSources || currentSources.filter(s => s.isEnabled).map(s => s.code),
      sourceStats
    });
  }

  /**
   * Normalizes, validates, scores anomalies, and stores an offer
   */
  private ingestOffer(
    gameId: string, 
    sourceCode: SourceCode, 
    rawOffer: NormalizedSourceOffer,
    knownBasePrice?: number
  ): void {
    const productNorm = normalizeProductType(rawOffer.productTypeRaw);
    if (!productNorm.isValid) return;

    const regionNorm = normalizeRegion(rawOffer.regionRaw);
    if (!regionNorm.isValid) return;

    const merchant = merchantRepo.getOrCreate(
      rawOffer.merchantCode, 
      rawOffer.merchantName, 
      rawOffer.isOfficial,
      rawOffer.dealUrl
    );

    const existingOffers = offerRepo.getOffersForGame(gameId);
    const otherPrices = existingOffers.map(o => o.priceEur);

    const anomalyEval = evaluateOfferAnomaly({
      priceEur: rawOffer.priceEur,
      originalPriceEur: rawOffer.originalPriceEur,
      basePriceEur: knownBasePrice,
      historicalLowEur: rawOffer.historicalLowEur,
      isOfficial: rawOffer.isOfficial,
      merchantTrustScore: merchant.trustScore,
      otherPrices
    });

    offerRepo.upsertOffer({
      gameId,
      merchantId: merchant.id,
      productType: productNorm.productType,
      regionType: regionNorm.regionType,
      regionCode: regionNorm.regionCode,
      regionConfidence: regionNorm.regionConfidence,
      priceEur: rawOffer.priceEur,
      originalPriceEur: rawOffer.originalPriceEur,
      rawPrice: rawOffer.rawPrice,
      rawCurrency: rawOffer.rawCurrency,
      rawOriginalPrice: rawOffer.rawOriginalPrice,
      voucherCode: rawOffer.voucherCode,
      dealUrl: rawOffer.dealUrl,
      isValid: true,
      sourceCode,
      rawObservationJson: rawOffer.rawPayload ? JSON.stringify(rawOffer.rawPayload) : undefined
    });
  }
}

export const syncOrchestrator = new SyncOrchestrator();
