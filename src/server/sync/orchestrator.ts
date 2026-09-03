import { config } from '../config/index.js';
import type { 
  SourceCode, 
  SyncProgressUpdate, 
  SyncStatusResponse,
  Offer
} from '../../shared/types.js';
import type { NormalizedSourceOffer } from '../sources/base.js';
import { 
  profileRepo,
  gameRepo, 
  offerRepo, 
  merchantRepo, 
  sourceRepo,
  type WishlistSyncGame 
} from '../db/index.js';
import { circuitBreakers } from './circuitBreaker.js';
import { calculateCoreSyncStatus } from './syncOutcome.js';
import { normalizeProductType, normalizeRegion } from '../domain/normalizer.js';
import { sendDealNotifications } from '../domain/discordNotifier.js';
import { steamAdapter } from '../sources/steam.js';
import { itadAdapter } from '../sources/itad.js';
import { cheapsharkAdapter } from '../sources/cheapshark.js';
import { ggdealsAdapter } from '../sources/ggdeals.js';
import { allkeyshopAdapter } from '../sources/allkeyshop.js';
import { allkeyshopQueue } from './allkeyshop/index.js';
import { computeNextInterval, isAllkeyshopDue, computeWishlistScrapePriority } from '../domain/allkeyshopScheduling.js';
import { exchangeRateService } from '../domain/exchangeRate.js';
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
    if (this.isRunning) {
      const err: any = new Error('A synchronization task is already in progress.');
      err.status = 409;
      throw err;
    }

    const profile = profileRepo.getById(profileId);
    if (!profile) {
      const err: any = new Error(`Profile ${profileId} not found`);
      err.status = 404;
      throw err;
    }

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
      const err: any = new Error('A synchronization task is already in progress.');
      err.status = 409;
      throw err;
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

      const isSourceEligible = (code: SourceCode): boolean => {
        if (!shouldRunSource(code)) return false;
        switch (code) {
          case 'steam': return steamAdapter.isEnabled();
          case 'itad': return itadAdapter.isEnabled();
          case 'cheapshark': return cheapsharkAdapter.isEnabled();
          case 'ggdeals': return ggdealsAdapter.isEnabled();
          case 'allkeyshop': return allkeyshopAdapter.isEnabled();
          default: return false;
        }
      };

      const SOURCE_DISPLAY_NAMES: Record<SourceCode, string> = {
        steam: 'Steam Store',
        itad: 'IsThereAnyDeal',
        cheapshark: 'CheapShark',
        ggdeals: 'GG.deals',
        allkeyshop: 'AllKeyShop'
      };

      const coreSourceCodes: SourceCode[] = ['steam', 'itad', 'cheapshark', 'ggdeals'];
      const activeCoreSources = coreSourceCodes.filter(c => isSourceEligible(c));
      const isKeyshopSelected = isSourceEligible('allkeyshop');
      const isKeyshopOnly = isKeyshopSelected && activeCoreSources.length === 0;

      // Refresh dynamic FX rates if cache expired
      try {
        await exchangeRateService.refreshRates();
      } catch (fxErr: any) {
        logWarn(`[FX] Could not update live exchange rates, using fallback: ${fxErr.message}`);
      }

      // Step 1: Fetch Steam Wishlist metadata
      this.progress.currentAction = `Fetching Steam Wishlist for ${profileName}...`;
      this.broadcast();

      const wishlistItems = await steamAdapter.fetchWishlist(steamId);
      totalWishlistCount = wishlistItems.length;
      this.progress.totalGames = totalWishlistCount;
      // Note: sourceProgress tracks price-source execution; do not set steam.total here
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
      
      let gamesToRefresh: WishlistSyncGame[] = [];
      if (activeCoreSources.length > 0) {
        // Auto-Heal: if any games have placeholder "App 123456" titles, force refresh their metadata
        gamesToRefresh = forceRefresh 
          ? allWishlistGames 
          : gameRepo.getStaleWishlistGameIds(profileId, config.cacheTtlHours);

        // Always include games with placeholder titles in gamesToRefresh so they get healed
        const placeholderAppIds = new Set(allWishlistGames.filter(g => g.title.startsWith('App ')).map(g => g.steamAppId));
        for (const g of allWishlistGames) {
          if (placeholderAppIds.has(g.steamAppId) && !gamesToRefresh.some(r => r.steamAppId === g.steamAppId)) {
            gamesToRefresh.push(g);
          }
        }

        staleQueriedCount = gamesToRefresh.length;
        const cachedCount = allWishlistGames.length - staleQueriedCount;
        cacheHitRatio = allWishlistGames.length > 0 ? Math.round((cachedCount / allWishlistGames.length) * 100) : 0;

        logInfo(`Cache Evaluation: ${gamesToRefresh.length} games require price refresh (${cacheHitRatio}% cache hit ratio)`);
      }

      // If core sources are selected and all are cached, and keyshop is not selected, finish immediately
      if (activeCoreSources.length > 0 && gamesToRefresh.length === 0 && !isKeyshopSelected) {
        const duration = Math.round((Date.now() - this.startTime) / 1000);
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.lastCoreSyncAt = new Date().toISOString();
        this.progress.currentAction = `All ${totalWishlistCount} games are up to date in cache (${config.cacheTtlHours}h TTL).`;
        this.broadcast();
        this.generateSummary(profileName, steamId, trigger, 'COMPLETED (CACHED)', duration, totalWishlistCount, 0, 100, 0, selectedSources);
        return;
      }

      const sourceOutcomes = new Map<SourceCode, 'SUCCESS' | 'FAILED'>();

      // Step 4: Fetch Detailed Steam Storefront Prices & Historical Lows
      if (shouldRunSource('steam') && gamesToRefresh.length > 0 && !this.isCancelled) {
        this.progress.sourceProgress.steam.total = gamesToRefresh.length;
        this.progress.sourceProgress.steam.processed = 0;
        this.progress.currentAction = `Fetching official Steam storefront prices for ${gamesToRefresh.length} games...`;
        this.broadcast();

        let steamSuccesses = 0;
        let steamFailures = 0;

        for (let i = 0; i < gamesToRefresh.length; i++) {
          if (this.isCancelled) return;
          const g = gamesToRefresh[i];
          this.progress.processedGames = i + 1;
          this.progress.currentAction = `Steam storefront: [${i + 1}/${gamesToRefresh.length}] ${g.title}`;

          try {
            // PERF-01: Single call to fetchPricesForGame (which fetches details once internally)
            const steamOffers = await steamAdapter.fetchPricesForGame(g.steamAppId);
            steamSuccesses++;
            for (const offer of steamOffers) {
              const details = offer.rawPayload;
              if (details && details.title && !details.title.startsWith('App ') && g.title.startsWith('App ')) {
                gameRepo.updateMetadata(g.steamAppId, {
                  title: details.title,
                  headerImage: details.headerImage,
                  capsuleImage: details.capsuleImage,
                  releaseDate: details.releaseDate,
                  isDlc: details.isDlc,
                  isFree: details.isFree,
                  basePriceEur: details.basePriceEur
                });
                g.title = details.title;
              }

              this.ingestOffer(g.id, 'steam', offer);
              this.progress.sourceProgress.steam.offersFound++;
              totalOffersIngested++;
            }
          } catch {
            steamFailures++;
          } finally {
            this.progress.sourceProgress.steam.processed = i + 1;
            if (i % 5 === 0 || i === gamesToRefresh.length - 1) {
              this.broadcast();
            }
          }
        }

        if (gamesToRefresh.length > 0) {
          sourceOutcomes.set('steam', steamSuccesses > 0 || steamFailures === 0 ? 'SUCCESS' : 'FAILED');
        }
      }

      if (this.isCancelled) return;

      // Step 5: High-Speed Batch Sources (ITAD, CheapShark, GG.deals)
      const batchTasks: Promise<void>[] = [];

      if (gamesToRefresh.length > 0) {
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
              sourceOutcomes.set('itad', 'SUCCESS');
              this.broadcast();
            } catch (e: any) {
              sourceOutcomes.set('itad', 'FAILED');
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
                const csTitle = (offers[0]?.rawPayload as any)?.title;
                if (csTitle && typeof csTitle === 'string' && csTitle.trim() && game.title.startsWith('App ')) {
                  gameRepo.updateMetadata(appId, { title: csTitle.trim() });
                  game.title = csTitle.trim();
                }
                for (const offer of offers) {
                  this.ingestOffer(game.id, 'cheapshark', offer);
                  this.progress.sourceProgress.cheapshark.offersFound++;
                  totalOffersIngested++;
                }
                this.progress.sourceProgress.cheapshark.processed++;
              }
              this.progress.sourceProgress.cheapshark.processed = gamesToRefresh.length;
              sourceOutcomes.set('cheapshark', 'SUCCESS');
              this.broadcast();
            } catch (e: any) {
              sourceOutcomes.set('cheapshark', 'FAILED');
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
              sourceOutcomes.set('ggdeals', 'SUCCESS');
              this.broadcast();
            } catch (e: any) {
              sourceOutcomes.set('ggdeals', 'FAILED');
              logWarn(`GG.deals batch sync warning: ${e?.message}`);
            }
          })());
        }

        if (batchTasks.length > 0) {
          this.progress.currentAction = `Simultaneously querying official stores via parallel batch APIs...`;
          this.broadcast();
          await Promise.allSettled(batchTasks);
        }
      }

      if (this.isCancelled) return;

      // Calculate 3-State Core Sync Outcome (REL-05)
      const { status: finalStatus, failedSources } = calculateCoreSyncStatus(activeCoreSources, sourceOutcomes);

      // Finalize Core Sync
      const duration = Math.round((Date.now() - this.startTime) / 1000);
      this.progress.status = finalStatus;
      this.progress.completedAt = new Date().toISOString();
      this.lastCoreSyncAt = new Date().toISOString();

      let completionAction: string;
      if (finalStatus === 'FAILED') {
        completionAction = `Core sync failed: all active price sources encountered errors.`;
      } else if (finalStatus === 'COMPLETED_WITH_WARNINGS') {
        const failedNames = failedSources.map(s => SOURCE_DISPLAY_NAMES[s] || s).join(', ');
        completionAction = `Core sync complete with warnings (${failedNames} failed).`;
      } else if (isKeyshopOnly) {
        completionAction = `Starting AllKeyShop refresh for ${allWishlistGames.length} wishlist games...`;
      } else {
        const allEnabledCoreCount = coreSourceCodes.filter(c => isSourceEnabled(c)).length;
        const isFullCore = activeCoreSources.length === allEnabledCoreCount;
        if (isFullCore) {
          completionAction = `Core sync complete! Refreshed official & batch deals for ${gamesToRefresh.length} games.`;
        } else {
          const activeNames = activeCoreSources.map(s => SOURCE_DISPLAY_NAMES[s] || s).join(', ');
          completionAction = `${activeNames} refresh complete for ${gamesToRefresh.length} games.`;
        }
      }

      this.progress.currentAction = completionAction;
      this.broadcast();

      this.generateSummary(profileName, steamId, trigger, finalStatus, duration, totalWishlistCount, staleQueriedCount, cacheHitRatio, totalOffersIngested, selectedSources);

      if (finalStatus === 'FAILED') {
        const err: any = new Error('All active price sources failed during core synchronization.');
        err.status = 502;
        throw err;
      }

      // Trigger Discord notifications for exceptional deals from core sync.
      // Note: Keyshop enrichment runs asynchronously after this in the background to avoid blocking the main sync.
      // If keyshop enrichment yields newly improved deals, a secondary post-enrichment alert pass is fired upon its completion.
      try {
        const bestDeals = gameRepo.getBestDeals(profileId, 50);
        await sendDealNotifications(bestDeals, trigger);
      } catch (notifyErr: any) {
        logWarn(`[Discord] Could not dispatch deal alerts: ${notifyErr.message}`);
      }

      // Step 6: Background Keyshop Enrichment (AllKeyShop)
      if (isKeyshopSelected && !this.isCancelled) {
        if (isKeyshopOnly) {
          await this.startBackgroundEnrichment(profileId, allWishlistGames, isKeyshopOnly, forceRefresh);
        } else {
          this.startBackgroundEnrichment(profileId, allWishlistGames, isKeyshopOnly, forceRefresh).catch(e => {
            logWarn(`[Enrichment] Background keyshop worker warning: ${e.message}`);
          });
        }
      }

      // Step 7: Cleanup Old Price History (Retention Policy) & Invalidate Expired Offers
      try {
        const retentionDays = config.historyRetentionDays || 90;
        const purgeRes = offerRepo.purgeOldPriceHistory(retentionDays);
        if (purgeRes.deletedCount > 0) {
          logInfo(`[Cleanup] Purged ${purgeRes.deletedCount} old price history records (older than ${retentionDays} days).`);
        }

        const invalidateRes = offerRepo.invalidateExpiredOffers();
        if (invalidateRes.invalidatedCount > 0) {
          logInfo(`[Cleanup] Invalidated ${invalidateRes.invalidatedCount} expired offer(s) older than 14 days.`);
        }
      } catch (purgeErr: any) {
        logWarn(`[Cleanup] Failed to purge old price history / invalidate offers: ${purgeErr.message}`);
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
  private async startBackgroundEnrichment(
    profileId: string, 
    games: WishlistSyncGame[], 
    isSourceOnly = false,
    forceRefresh = false
  ): Promise<void> {
    if (this.enrichmentStatus.isRunning) {
      logInfo('[Enrichment] Background enrichment already in progress.');
      return;
    }

    if (!allkeyshopAdapter.isEnabled()) {
      logInfo('[Enrichment] AllKeyShop background enrichment disabled (no solver configured). Skipping.');
      return;
    }

    const dueGames = forceRefresh 
      ? [...games].sort((a, b) => computeWishlistScrapePriority(b) - computeWishlistScrapePriority(a)) 
      : games
          .filter(g => isAllkeyshopDue(g))
          .sort((a, b) => computeWishlistScrapePriority(b) - computeWishlistScrapePriority(a));
    const maxGames = config.allkeyshopMaxGames;
    const prioritizedGames = (maxGames > 0 && maxGames < dueGames.length) 
      ? dueGames.slice(0, maxGames) 
      : dueGames;

    if (prioritizedGames.length === 0) {
      logInfo('[Enrichment] AllKeyShop background worker: no games currently due for refresh.');
      if (isSourceOnly) {
        this.progress.currentAction = 'AllKeyShop refresh complete: all games are up to date.';
        this.broadcast();
      }
      return;
    }

    this.enrichmentStatus = {
      isRunning: true,
      total: prioritizedGames.length,
      processed: 0,
      offersFound: 0,
      currentGameTitle: undefined
    };

    this.progress.sourceProgress.allkeyshop = {
      processed: 0,
      total: prioritizedGames.length,
      offersFound: 0,
      state: 'NORMAL'
    };
    if (isSourceOnly) {
      this.progress.currentAction = `AllKeyShop refresh in progress for ${prioritizedGames.length} games...`;
    }
    this.broadcast();

    logInfo(`[Enrichment] Starting background Keyshop worker for ${prioritizedGames.length} due games (out of ${games.length} total).`);
    const chunkSize = config.allkeyshopChunkSize;
    const pauseMs = config.allkeyshopChunkPauseMs;
    const hasSolver = Boolean(config.allkeyshopSolverUrl?.trim());

    try {
      for (let i = 0; i < prioritizedGames.length; i++) {
        if (this.isCancelled) break;
        const g = prioritizedGames[i];
        this.enrichmentStatus.processed = i + 1;
        this.enrichmentStatus.currentGameTitle = g.title;
        this.progress.sourceProgress.allkeyshop.processed = i + 1;

        let lowestPriceEur: number | null = null;
        let newOffersCount = 0;
        const freshAksOfferIds: string[] = [];
        try {
          const offers = await allkeyshopAdapter.fetchPricesForGame(g.steamAppId, g.title, g.itadId, g.releaseDate);
          for (const offer of offers) {
            const saved = this.ingestOffer(g.id, 'allkeyshop', offer);
            if (saved?.id) {
              freshAksOfferIds.push(saved.id);
            }
            this.enrichmentStatus.offersFound++;
            newOffersCount++;
            if (offer.priceEur > 0 && (lowestPriceEur === null || offer.priceEur < lowestPriceEur)) {
              lowestPriceEur = offer.priceEur;
            }
          }
          if (offers.length > 0) {
            offerRepo.invalidateStaleForGameSource(g.id, 'allkeyshop', freshAksOfferIds);
            offerRepo.recomputeBestDealForGame(g.id);
          }
          this.progress.sourceProgress.allkeyshop.offersFound += newOffersCount;

          // Adaptive interval recomputation after each check
          const prevPrice = g.allkeyshopLastPriceEur !== undefined && g.allkeyshopLastPriceEur !== null
            ? Number(g.allkeyshopLastPriceEur)
            : null;
          const streak = g.allkeyshopUnchangedStreak ?? 0;
          const prevInterval = g.allkeyshopCheckIntervalHours ?? 24;
          const hasActiveTargetPrice = g.targetPriceEur !== undefined && g.targetPriceEur !== null;

          const nextSchedule = computeNextInterval(
            prevPrice,
            lowestPriceEur,
            streak,
            prevInterval,
            hasActiveTargetPrice
          );

          const nowIso = new Date().toISOString();
          gameRepo.updateAllkeyshopCheckState(
            g.id,
            nowIso,
            lowestPriceEur,
            nextSchedule.intervalHours,
            nextSchedule.streak
          );
        } catch {
          // Ignore individual keyshop scraping errors and do not mark as checked
        }

        if (isSourceOnly) {
          this.progress.currentAction = `AllKeyShop: [${i + 1}/${prioritizedGames.length}] ${g.title}`;
        }
        this.broadcast();

        // Anti-ban Cooldown Break: every `chunkSize` games
        const isChunkEnd = (i + 1) % chunkSize === 0 && (i + 1) < prioritizedGames.length;
        if (isChunkEnd && !this.isCancelled) {
          logInfo(`[Enrichment] Completed chunk of ${chunkSize} games. Cooling down for ${Math.round(pauseMs / 1000)}s.`);
          await new Promise(r => setTimeout(r, pauseMs));
        } else if (!hasSolver && (i + 1) < prioritizedGames.length && !this.isCancelled) {
          // Occasional irregular hesitation break (~5% probability) of 5-15 minutes ONLY for raw scraping without solver
          if (Math.random() < 0.05) {
            const hesitationMinutes = 5 + Math.random() * 10;
            const hesitationMs = Math.round(hesitationMinutes * 60 * 1000);
            logInfo(`[Enrichment] Natural pacing hesitation: pausing for ${(hesitationMs / 1000 / 60).toFixed(1)} minutes.`);
            await new Promise(r => setTimeout(r, hesitationMs));
          }
        }
      }

      this.lastEnrichmentAt = new Date().toISOString();
      logInfo(`[Enrichment] Keyshop background enrichment completed. Found ${this.enrichmentStatus.offersFound} offers.`);
      if (isSourceOnly) {
        this.progress.currentAction = `AllKeyShop refresh complete for ${prioritizedGames.length} games.`;
        this.broadcast();
      }

      // Secondary lightweight deal notification pass for keyshop-driven deals
      if (this.enrichmentStatus.offersFound > 0) {
        try {
          const bestDeals = gameRepo.getBestDeals(profileId, 50);
          await sendDealNotifications(bestDeals, 'allkeyshop_enrichment');
        } catch (e: any) {
          logWarn(`[Discord] Could not dispatch post-enrichment deal alerts: ${e.message}`);
        }
      }
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
  ): Offer | undefined {
    const productNorm = normalizeProductType(rawOffer.productTypeRaw, rawOffer.merchantName);
    if (!productNorm.isValid) return;

    const regionNorm = normalizeRegion(rawOffer.regionRaw);
    if (!regionNorm.isValid) return;

    const merchant = merchantRepo.getOrCreate(
      rawOffer.merchantCode, 
      rawOffer.merchantName, 
      rawOffer.isOfficial,
      rawOffer.dealUrl
    );

    return offerRepo.upsertOffer({
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

  /**
   * Refreshes pricing for a single specific game across active fast sources
   * (Steam, ITAD, CheapShark, GG.deals) with asynchronous background AllKeyShop enrichment.
   */
  public async refreshGame(
    gameId: string,
    options?: { sources?: SourceCode[]; includeKeyshops?: boolean }
  ): Promise<{
    success: boolean;
    game: any;
    offers: any[];
    history: any[];
    intelligence: any;
    refreshedAt: string;
    sourcesChecked: SourceCode[];
    sourcesFailed: SourceCode[];
    sourcesSkipped: SourceCode[];
    circuitStates: Record<string, string>;
  }> {
    const game = gameRepo.getById(gameId);
    if (!game) {
      throw new Error(`Game with ID ${gameId} not found`);
    }

    const currentSources = sourceRepo.list();
    const isSourceEnabled = (code: SourceCode) => {
      const s = currentSources.find(src => src.code === code);
      return s ? Boolean(s.isEnabled) : true;
    };

    const requestedSources = options?.sources;
    const allFastSources: SourceCode[] = ['steam', 'itad', 'cheapshark', 'ggdeals'];
    const fastSources = requestedSources
      ? allFastSources.filter(s => requestedSources.includes(s))
      : allFastSources;

    const sourcesChecked: SourceCode[] = [];
    const sourcesFailed: SourceCode[] = [];
    const sourcesSkipped: SourceCode[] = [];
    const circuitStates: Record<string, string> = {};

    const fastTasks: Promise<void>[] = [];

    for (const sourceCode of fastSources) {
      const state = circuitBreakers.getState(sourceCode);
      circuitStates[sourceCode] = state;

      if (!isSourceEnabled(sourceCode)) {
        sourcesSkipped.push(sourceCode);
        continue;
      }

      if (!circuitBreakers.canExecute(sourceCode).allowed) {
        sourcesSkipped.push(sourceCode);
        continue;
      }

      sourcesChecked.push(sourceCode);

      const task = (async () => {
        try {
          let offers: NormalizedSourceOffer[] = [];
          if (sourceCode === 'steam') {
            offers = await steamAdapter.fetchPricesForGame(game.steamAppId);
          } else if (sourceCode === 'itad') {
            offers = await itadAdapter.fetchPricesForGame(game.steamAppId, game.title, game.itadId || undefined);
          } else if (sourceCode === 'cheapshark') {
            offers = await cheapsharkAdapter.fetchPricesForGame(game.steamAppId, game.title);
          } else if (sourceCode === 'ggdeals') {
            offers = await ggdealsAdapter.fetchPricesForGame(game.steamAppId, game.title);
          }

          circuitBreakers.recordSuccess(sourceCode);

          for (const offer of offers) {
            this.ingestOffer(gameId, sourceCode, offer, game.basePriceEur);
          }
        } catch (err: any) {
          logWarn(`[Force Refresh] Source ${sourceCode} failed for game "${game.title}": ${err.message}`);
          circuitBreakers.recordFailure(sourceCode, err);
          sourcesFailed.push(sourceCode);
        }
      })();

      fastTasks.push(task);
    }

    // Await all fast sources concurrently
    await Promise.allSettled(fastTasks);

    // Recompute best deal for this game
    offerRepo.recomputeBestDealForGame(gameId);

    // Non-blocking background AllKeyShop enrichment
    const includeKeyshops = requestedSources
      ? requestedSources.includes('allkeyshop')
      : (options?.includeKeyshops ?? true);

    if (includeKeyshops && isSourceEnabled('allkeyshop')) {
      const cbCheck = circuitBreakers.canExecute('allkeyshop');
      if (!cbCheck.allowed || allkeyshopQueue.isCoolingDown) {
        const remaining = allkeyshopQueue.getCooldownRemainingSec();
        logInfo(`[Force Refresh] AllKeyShop enrichment skipped for "${game.title}": source is cooling down (${remaining}s remaining).`);
        sourcesSkipped.push('allkeyshop');
      } else {
        (async () => {
          try {
            logInfo(`[Force Refresh] Starting background AllKeyShop enrichment for "${game.title}"...`);
            const aksOffers = await allkeyshopAdapter.fetchPricesForGame(game.steamAppId, game.title, game.itadId, game.releaseDate);
            let lowestAksPrice: number | null = null;
            const freshAksOfferIds: string[] = [];
            for (const offer of aksOffers) {
              const saved = this.ingestOffer(gameId, 'allkeyshop', offer, game.basePriceEur);
              if (saved?.id) {
                freshAksOfferIds.push(saved.id);
              }
              if (offer.priceEur > 0 && (lowestAksPrice === null || offer.priceEur < lowestAksPrice)) {
                lowestAksPrice = offer.priceEur;
              }
            }
            if (aksOffers.length > 0) {
              offerRepo.invalidateStaleForGameSource(gameId, 'allkeyshop', freshAksOfferIds);
            }
            const nowIso = new Date().toISOString();
            gameRepo.updateAllkeyshopCheckState(gameId, nowIso, lowestAksPrice, 24, 0);
            offerRepo.recomputeBestDealForGame(gameId);
            logInfo(`[Force Refresh] Background AllKeyShop enrichment complete for "${game.title}" (${aksOffers.length} offers).`);
          } catch (aksErr: any) {
            logWarn(`[Force Refresh] Background AllKeyShop enrichment failed for "${game.title}": ${aksErr.message}`);
          }
        })().catch(() => {});
      }
    }

    return {
      success: true,
      game: gameRepo.getById(gameId),
      offers: offerRepo.getOffersForGame(gameId),
      history: offerRepo.getPriceHistory(gameId, 50),
      intelligence: gameRepo.getPriceIntelligence(gameId),
      refreshedAt: new Date().toISOString(),
      sourcesChecked,
      sourcesFailed,
      sourcesSkipped,
      circuitStates
    };
  }
}

export const syncOrchestrator = new SyncOrchestrator();
