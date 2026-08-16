import { config } from '../config/index.js';
import type { 
  SourceCode, 
  SyncProgressUpdate, 
  SyncStatusResponse 
} from '../../shared/types.js';
import type { NormalizedSourceOffer } from '../sources/base.js';
import { 
  gameRepo, 
  offerRepo, 
  merchantRepo, 
  sourceRepo 
} from '../db/index.js';
import { circuitBreakers } from './circuitBreaker.js';
import { normalizeProductType, normalizeRegion } from '../domain/normalizer.js';
import { sendDealNotifications } from '../domain/discordNotifier.js';
import { steamAdapter } from '../sources/steam.js';
import { itadAdapter } from '../sources/itad.js';
import { cheapsharkAdapter } from '../sources/cheapshark.js';
import { ggdealsAdapter } from '../sources/ggdeals.js';
import { allkeyshopAdapter } from '../sources/allkeyshop.js';
import { logInfo, logWarn, logError, logSummaryReport } from '../utils/logger.js';
import { randomUUID } from 'crypto';

export class SyncOrchestrator {
  private isRunning = false;
  private isCancelled = false;
  private activeRunId: string | null = null;
  private startTime = 0;
  private progressListeners: ((progress: SyncProgressUpdate) => void)[] = [];
  
  // Background Keyshop Enrichment Worker state
  private enrichmentStatus = {
    isRunning: false,
    total: 0,
    processed: 0,
    offersFound: 0,
    currentGameTitle: undefined as string | undefined
  };
  private lastCoreSyncAt: string | undefined = undefined;
  private lastEnrichmentAt: string | undefined = undefined;

  private progress: SyncProgressUpdate = {
    status: 'IDLE',
    currentAction: 'Idle',
    totalGames: 0,
    processedGames: 0,
    startTime: 0,
    sourceProgress: {
      steam: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
      itad: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
      ggdeals: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
      cheapshark: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
      allkeyshop: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' }
    }
  };

  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  public subscribe(listener: (progress: SyncProgressUpdate) => void): () => void {
    return this.onProgress(listener);
  }

  public onProgress(listener: (progress: SyncProgressUpdate) => void): () => void {
    this.progressListeners.push(listener);
    return () => {
      this.progressListeners = this.progressListeners.filter(l => l !== listener);
    };
  }

  public async startSync(
    profileId: string, 
    forceRefresh: boolean = false, 
    selectedSources?: SourceCode[],
    trigger: 'MANUAL' | 'SCHEDULED' | 'STARTUP' = 'MANUAL'
  ): Promise<SyncProgressUpdate> {
    const profile = (await import('../db/index.js')).profileRepo.getById(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found`);

    // Run executeSync in background and return initial progress immediately
    this.executeSync(profile.id, profile.steamId, profile.name, forceRefresh, trigger, selectedSources).catch(err => {
      logError(`Async sync error: ${err.message}`);
    });

    return this.getProgress();
  }

  public getProgress(): SyncProgressUpdate {
    const states = circuitBreakers.getAllStates();
    for (const code of Object.keys(this.progress.sourceProgress) as SourceCode[]) {
      if (this.progress.sourceProgress[code]) {
        this.progress.sourceProgress[code].state = states[code] || 'NORMAL';
      }
    }
    return { ...this.progress };
  }

  public getSyncStatus(): SyncStatusResponse {
    return {
      isCoreSyncRunning: this.isRunning,
      isEnrichmentRunning: this.enrichmentStatus.isRunning,
      lastCoreSyncAt: this.lastCoreSyncAt,
      lastEnrichmentAt: this.lastEnrichmentAt,
      enrichmentProgress: this.enrichmentStatus.isRunning ? {
        total: this.enrichmentStatus.total,
        processed: this.enrichmentStatus.processed,
        offersFound: this.enrichmentStatus.offersFound,
        currentGameTitle: this.enrichmentStatus.currentGameTitle
      } : undefined
    };
  }

  private broadcast(): void {
    const p = this.getProgress();
    for (const listener of this.progressListeners) {
      try {
        listener(p);
      } catch (e) {
        // Listener error ignored
      }
    }
  }

  public cancelSync(): void {
    if (this.isRunning) {
      this.isCancelled = true;
      this.progress.status = 'CANCELLED';
      this.progress.currentAction = 'Synchronization cancelled by user.';
      this.broadcast();
    }
  }

  /**
   * Main sync workflow:
   * 1. Fetches Steam Wishlist items
   * 2. Ingests / updates games in SQLite database
   * 3. Evaluates TTL Cache for stale games
   * 4. Queries Steam Storefront for fresh base details & historical low
   * 5. Queries Batch APIs concurrently (ITAD, CheapShark, GG.deals)
   * 6. Finishes Core Sync immediately (returns to user & notifies Discord)
   * 7. Runs non-blocking background keyshop enrichment (AllKeyShop)
   */
  public async executeSync(
    profileId: string, 
    steamId: string, 
    profileName: string, 
    forceRefresh: boolean = false, 
    trigger: 'MANUAL' | 'SCHEDULED' | 'STARTUP' = 'MANUAL',
    selectedSources?: SourceCode[]
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('A synchronization task is already in progress.');
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.activeRunId = randomUUID();
    this.startTime = Date.now();

    this.progress = {
      status: 'RUNNING',
      currentAction: 'Starting sync...',
      totalGames: 0,
      processedGames: 0,
      startTime: this.startTime,
      sourceProgress: {
        steam: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        itad: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        ggdeals: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        cheapshark: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        allkeyshop: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' }
      }
    };
    this.broadcast();

    let totalWishlistCount = 0;
    let staleQueriedCount = 0;
    let cacheHitRatio = 0;
    let totalOffersIngested = 0;

    try {
      const isSourceEnabled = (code: SourceCode) => {
        const src = sourceRepo.getByCode(code);
        return src ? src.isEnabled : true;
      };

      const shouldRunSource = (code: SourceCode) => {
        if (selectedSources && selectedSources.length > 0) {
          return selectedSources.includes(code) && isSourceEnabled(code);
        }
        return isSourceEnabled(code);
      };

      // Step 1: Fetch Steam Wishlist
      this.progress.currentAction = `Fetching Steam Wishlist for ${profileName}...`;
      this.broadcast();

      const wishlistItems = await steamAdapter.fetchWishlist(steamId);
      totalWishlistCount = wishlistItems.length;
      this.progress.totalGames = totalWishlistCount;
      this.progress.sourceProgress.steam.total = totalWishlistCount;
      this.broadcast();

      if (this.isCancelled) return;

      if (wishlistItems.length === 0) {
        this.progress.status = 'COMPLETED';
        this.progress.currentAction = 'Wishlist is empty or profile is private.';
        this.progress.completedAt = new Date().toISOString();
        this.broadcast();
        return;
      }

      // Step 2: Ingest games into local SQLite database
      this.progress.currentAction = `Syncing ${wishlistItems.length} wishlist entries to database...`;
      this.broadcast();

      gameRepo.syncWishlistEntries(profileId, wishlistItems.map(item => ({
        steamAppId: item.steamAppId,
        title: item.title,
        priority: item.priority,
        dateAdded: item.dateAdded,
        headerImage: item.headerImage,
        capsuleImage: item.capsuleImage,
        releaseDate: item.releaseDate,
        isDlc: item.isDlc,
        isFree: item.isFree,
        basePriceEur: item.basePriceEur
      })));

      // Step 3: Check TTL Cache
      const allWishlistGames = gameRepo.getAllWishlistGameIds(profileId);
      let gamesToRefresh = forceRefresh 
        ? allWishlistGames 
        : gameRepo.getStaleWishlistGameIds(profileId, config.cacheTtlHours);

      staleQueriedCount = gamesToRefresh.length;
      const cachedCount = allWishlistGames.length - staleQueriedCount;
      cacheHitRatio = allWishlistGames.length > 0 ? Math.round((cachedCount / allWishlistGames.length) * 100) : 0;

      logInfo(`Cache Evaluation: ${gamesToRefresh.length} games require price refresh (${cacheHitRatio}% cache hit ratio)`);

      if (gamesToRefresh.length === 0) {
        const duration = Math.round((Date.now() - this.startTime) / 1000);
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.lastCoreSyncAt = new Date().toISOString();
        this.progress.currentAction = `All ${totalWishlistCount} games are up to date in cache (${config.cacheTtlHours}h TTL).`;
        this.broadcast();
        this.generateSummary(profileName, steamId, trigger, 'COMPLETED (CACHED)', duration, totalWishlistCount, 0, 100, 0, selectedSources);
        return;
      }

      // Step 4: Fetch Detailed Steam Storefront Prices & Historical Lows
      if (shouldRunSource('steam') && !this.isCancelled) {
        this.progress.sourceProgress.steam.total = gamesToRefresh.length;
        this.progress.sourceProgress.steam.processed = 0;
        this.progress.currentAction = `Fetching official Steam storefront prices for ${gamesToRefresh.length} games...`;
        this.broadcast();

        for (let i = 0; i < gamesToRefresh.length; i++) {
          if (this.isCancelled) return;
          const g = gamesToRefresh[i];
          this.progress.processedGames = i + 1;
          this.progress.currentAction = `Steam storefront: [${i + 1}/${gamesToRefresh.length}] ${g.title}`;

          try {
            const steamOffers = await steamAdapter.fetchPricesForGame(g.steamAppId);
            for (const offer of steamOffers) {
              this.ingestOffer(g.id, 'steam', offer);
              this.progress.sourceProgress.steam.offersFound++;
              totalOffersIngested++;
            }
          } catch {
            // Non-fatal, continue with next game
          } finally {
            this.progress.sourceProgress.steam.processed = i + 1;
            if (i % 5 === 0 || i === gamesToRefresh.length - 1) {
              this.broadcast();
            }
          }
        }
      }

      if (this.isCancelled) return;

      // Step 5: High-Speed Batch Sources (ITAD, CheapShark, GG.deals)
      const batchTasks: Promise<void>[] = [];

      // ITAD Batch Sync
      if (shouldRunSource('itad') && itadAdapter.isEnabled()) {
        batchTasks.push((async () => {
          try {
            this.progress.sourceProgress.itad.total = gamesToRefresh.length;
            this.broadcast();

            const itadBatchResults = await itadAdapter.fetchBatchPrices(gamesToRefresh);
            for (const [appId, offers] of itadBatchResults.entries()) {
              const game = gamesToRefresh.find(w => w.steamAppId === appId);
              if (!game) continue;
              for (const offer of offers) {
                this.ingestOffer(game.id, 'itad', offer);
                this.progress.sourceProgress.itad.offersFound++;
                totalOffersIngested++;
              }
              this.progress.sourceProgress.itad.processed++;
            }
            this.progress.sourceProgress.itad.processed = gamesToRefresh.length;
            this.broadcast();
          } catch (e: any) {
            logWarn(`ITAD batch sync warning: ${e?.message}`);
          }
        })());
      }

      // CheapShark Batch Sync
      if (shouldRunSource('cheapshark') && cheapsharkAdapter.isEnabled()) {
        batchTasks.push((async () => {
          try {
            this.progress.sourceProgress.cheapshark.total = gamesToRefresh.length;
            this.broadcast();

            const csBatchResults = await cheapsharkAdapter.fetchBatchPrices(gamesToRefresh);
            for (const [appId, offers] of csBatchResults.entries()) {
              const game = gamesToRefresh.find(w => w.steamAppId === appId);
              if (!game) continue;
              for (const offer of offers) {
                this.ingestOffer(game.id, 'cheapshark', offer);
                this.progress.sourceProgress.cheapshark.offersFound++;
                totalOffersIngested++;
              }
              this.progress.sourceProgress.cheapshark.processed++;
            }
            this.progress.sourceProgress.cheapshark.processed = gamesToRefresh.length;
            this.broadcast();
          } catch (e: any) {
            logWarn(`CheapShark batch sync warning: ${e?.message}`);
          }
        })());
      }

      // GG.deals Batch Sync
      if (shouldRunSource('ggdeals') && ggdealsAdapter.isEnabled()) {
        batchTasks.push((async () => {
          try {
            this.progress.sourceProgress.ggdeals.total = gamesToRefresh.length;
            this.broadcast();

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

      if (batchTasks.length > 0) {
        this.progress.currentAction = `Simultaneously querying official stores via parallel batch APIs...`;
        this.broadcast();
        await Promise.allSettled(batchTasks);
      }

      // Finalize Core Sync Immediately
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.progress.status = 'COMPLETED';
      this.progress.completedAt = new Date().toISOString();
      this.lastCoreSyncAt = new Date().toISOString();
      this.progress.currentAction = `Core sync complete! Refreshed official & batch deals for ${gamesToRefresh.length} games.`;
      this.broadcast();

      this.generateSummary(profileName, steamId, trigger, 'COMPLETED', duration, totalWishlistCount, staleQueriedCount, cacheHitRatio, totalOffersIngested, selectedSources);

      // Trigger Discord notifications for exceptional deals from core sync
      try {
        const bestDeals = gameRepo.getBestDeals(profileId, 50);
        await sendDealNotifications(bestDeals, trigger);
      } catch (notifyErr: any) {
        logWarn(`[Discord] Could not dispatch deal alerts: ${notifyErr.message}`);
      }

      // Step 6: Non-Blocking Background Keyshop Enrichment (AllKeyShop)
      if (shouldRunSource('allkeyshop') && allkeyshopAdapter.isEnabled() && !this.isCancelled) {
        this.startBackgroundEnrichment(profileId, gamesToRefresh).catch(e => {
          logWarn(`[Enrichment] Background keyshop worker warning: ${e.message}`);
        });
      }

    } catch (err: any) {
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.progress.status = 'FAILED';
      this.progress.currentAction = `Sync failed: ${err.message || 'Unknown error'}`;
      this.broadcast();

      this.generateSummary(profileName, steamId, trigger, 'FAILED', duration, totalWishlistCount, staleQueriedCount, 0, totalOffersIngested, selectedSources);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Non-blocking background worker that enriches games with AllKeyShop keyshop offers
   */
  private async startBackgroundEnrichment(profileId: string, games: any[]): Promise<void> {
    if (this.enrichmentStatus.isRunning) {
      logInfo('[Enrichment] Background enrichment already in progress.');
      return;
    }

    const maxGames = config.allkeyshopMaxGames;
    const prioritizedGames = (maxGames > 0 && maxGames < games.length) 
      ? games.slice(0, maxGames) 
      : games;

    if (prioritizedGames.length === 0) return;

    this.enrichmentStatus = {
      isRunning: true,
      total: prioritizedGames.length,
      processed: 0,
      offersFound: 0,
      currentGameTitle: undefined
    };

    logInfo(`[Enrichment] Starting background Keyshop worker for ${prioritizedGames.length} games.`);
    const chunkSize = config.allkeyshopChunkSize;
    const pauseMs = config.allkeyshopChunkPauseMs;

    try {
      for (let i = 0; i < prioritizedGames.length; i++) {
        if (this.isCancelled) break;
        const g = prioritizedGames[i];
        this.enrichmentStatus.processed = i + 1;
        this.enrichmentStatus.currentGameTitle = g.title;

        try {
          const offers = await allkeyshopAdapter.fetchPricesForGame(g.steamAppId, g.title);
          for (const offer of offers) {
            this.ingestOffer(g.id, 'allkeyshop', offer);
            this.enrichmentStatus.offersFound++;
          }
        } catch {
          // Ignore individual keyshop scraping errors
        }

        // Anti-ban Cooldown Break: every `chunkSize` games
        const isChunkEnd = (i + 1) % chunkSize === 0 && (i + 1) < prioritizedGames.length;
        if (isChunkEnd && !this.isCancelled) {
          logInfo(`[Enrichment] Completed chunk of ${chunkSize} games. Cooling down for ${Math.round(pauseMs / 1000)}s.`);
          await new Promise(r => setTimeout(r, pauseMs));
        }
      }

      this.lastEnrichmentAt = new Date().toISOString();
      logInfo(`[Enrichment] Keyshop background enrichment completed. Found ${this.enrichmentStatus.offersFound} offers.`);
    } finally {
      this.enrichmentStatus.isRunning = false;
      this.enrichmentStatus.currentGameTitle = undefined;
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
