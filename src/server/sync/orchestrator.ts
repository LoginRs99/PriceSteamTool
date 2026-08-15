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
    // Send current state immediately
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
    // Refresh circuit breaker states
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
      this.broadcast();
    }
  }

  public async startSync(profileId?: string, forceRefresh: boolean = false): Promise<SyncProgressUpdate> {
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

    // Run execution in background so HTTP response is returned immediately
    this.runSyncPipeline(targetProfile.id, targetProfile.steamId, forceRefresh).catch(err => {
      console.error('Sync pipeline failed:', err);
      this.progress.status = 'FAILED';
      this.progress.currentAction = `Error: ${err.message || 'Sync failed'}`;
      this.broadcast();
    });

    return this.getProgress();
  }

  private async runSyncPipeline(profileId: string, steamId: string, forceRefresh: boolean): Promise<void> {
    try {
      // Step 1: Ingest Steam Wishlist
      this.progress.currentAction = 'Fetching Wishlist from Steam API...';
      this.broadcast();

      const wishlistItems = await steamAdapter.fetchWishlist(steamId);
      if (this.isCancelled) return;

      if (wishlistItems.length === 0) {
        this.progress.currentAction = 'Wishlist is empty or profile is private.';
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.broadcast();
        return;
      }

      this.progress.totalGames = wishlistItems.length;
      this.progress.currentAction = `Discovered ${wishlistItems.length} games. Resolving metadata...`;
      this.broadcast();

      // Step 2: Ingest games and sync wishlist entries in SQLite
      gameRepo.syncWishlistEntries(
        profileId, 
        wishlistItems.map(w => ({ steamAppId: w.steamAppId, title: `App ${w.steamAppId}`, priority: w.priority, dateAdded: w.dateAdded }))
      );

      // Step 3: Populate metadata for games that are missing title/images
      const allWishlistGames = gameRepo.getAllWishlistGameIds(profileId);
      this.progress.currentAction = 'Checking store assets and titles...';
      this.broadcast();

      for (let i = 0; i < allWishlistGames.length; i++) {
        if (this.isCancelled) return;
        const g = allWishlistGames[i];
        
        // If title is just placeholder App ID, fetch store details
        if (g.title.startsWith('App ')) {
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

              // Store Steam baseline price
              if (details.currentPriceEur !== undefined) {
                this.ingestOffer(updatedGame.id, 'steam', {
                  merchantCode: 'steam',
                  merchantName: 'Steam Store',
                  isOfficial: true,
                  productTypeRaw: 'DIRECT_PURCHASE',
                  regionRaw: 'GLOBAL',
                  priceEur: details.currentPriceEur,
                  originalPriceEur: details.basePriceEur,
                  dealUrl: `https://store.steampowered.com/app/${g.steamAppId}/`
                }, updatedGame.basePriceEur);
                this.progress.sourceProgress.steam.offersFound++;
              }
            }
          } catch (e) {
            // Ignore single game detail error
          }
        }
        this.progress.sourceProgress.steam.processed++;
      }

      // Step 4: Determine which games require price refreshes (Cache-First TTL Strategy)
      const gamesToRefresh = forceRefresh 
        ? allWishlistGames 
        : gameRepo.getStaleWishlistGameIds(profileId, config.cacheTtlHours);

      if (gamesToRefresh.length === 0) {
        this.progress.status = 'COMPLETED';
        this.progress.completedAt = new Date().toISOString();
        this.progress.currentAction = `Wishlist is up to date (cached). No stale items to refresh.`;
        this.broadcast();
        return;
      }

      this.progress.currentAction = `Found ${gamesToRefresh.length} items needing price refresh...`;
      this.broadcast();

      // Step 5: IsThereAnyDeal Batch Sync (Primary Official Aggregator)
      const sourcesList = sourceRepo.list();
      const itadConfig = sourcesList.find(s => s.code === 'itad');
      if (itadConfig?.isEnabled && !this.isCancelled) {
        this.progress.currentAction = 'Refreshing prices via IsThereAnyDeal batch API...';
        this.progress.sourceProgress.itad.total = gamesToRefresh.length;
        this.broadcast();

        try {
          const itadBatchResults = await itadAdapter.fetchBatchPrices(gamesToRefresh);
          for (const [appId, offers] of itadBatchResults.entries()) {
            const game = gamesToRefresh.find(w => w.steamAppId === appId);
            if (!game) continue;

            for (const offer of offers) {
              this.ingestOffer(game.id, 'itad', offer);
              this.progress.sourceProgress.itad.offersFound++;
            }
            this.progress.sourceProgress.itad.processed++;
          }
        } catch (e: any) {
          console.warn('ITAD sync error:', e?.message);
        }
      }

      // Step 6: Secondary Sources Dispatch (GG.deals, CheapShark, AllKeyShop, GoCDKeys)
      const secondaryAdapters: PriceSourceAdapter[] = [];
      if (sourcesList.find(s => s.code === 'ggdeals')?.isEnabled) secondaryAdapters.push(ggdealsAdapter);
      if (sourcesList.find(s => s.code === 'cheapshark')?.isEnabled) secondaryAdapters.push(cheapsharkAdapter);
      if (sourcesList.find(s => s.code === 'allkeyshop')?.isEnabled) secondaryAdapters.push(allkeyshopAdapter);
      if (sourcesList.find(s => s.code === 'gocdkeys')?.isEnabled) secondaryAdapters.push(gocdkeysAdapter);

      for (const adapter of secondaryAdapters) {
        this.progress.sourceProgress[adapter.code].total = gamesToRefresh.length;
      }
      this.broadcast();

      // Process games through secondary source adapters with controlled pacing
      for (let i = 0; i < gamesToRefresh.length; i++) {
        if (this.isCancelled) return;
        const g = gamesToRefresh[i];
        this.progress.processedGames = i + 1;
        this.progress.currentAction = `Updating prices: [${i + 1}/${gamesToRefresh.length}] ${g.title}`;

        // Query secondary adapters concurrently across decoupled queues
        await Promise.allSettled(
          secondaryAdapters.map(async (adapter) => {
            try {
              const offers = await adapter.fetchPricesForGame(g.steamAppId, g.title, g.itadId);
              for (const offer of offers) {
                this.ingestOffer(g.id, adapter.code, offer);
                this.progress.sourceProgress[adapter.code].offersFound++;
              }
            } catch (err: any) {
              // Circuit breaker and rate limiter handle the error recording
            } finally {
              this.progress.sourceProgress[adapter.code].processed++;
            }
          })
        );

        if (i % 5 === 0 || i === gamesToRefresh.length - 1) {
          this.broadcast();
        }
      }

      // Finalize
      this.progress.status = 'COMPLETED';
      this.progress.completedAt = new Date().toISOString();
      this.progress.currentAction = `Sync completed! Refreshed ${gamesToRefresh.length} games.`;
      this.broadcast();

    } catch (err: any) {
      this.progress.status = 'FAILED';
      this.progress.currentAction = `Sync failed: ${err.message || 'Unknown error'}`;
      this.broadcast();
      throw err;
    }
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
    // 1. Validate Product Type
    const productNorm = normalizeProductType(rawOffer.productTypeRaw);
    if (!productNorm.isValid) {
      // Discard forbidden account products as per spec
      return;
    }

    // 2. Validate Region
    const regionNorm = normalizeRegion(rawOffer.regionRaw);
    if (!regionNorm.isValid) {
      // Discard foreign region-locked products
      return;
    }

    // 3. Ensure Merchant exists in DB
    const merchant = merchantRepo.getOrCreate(
      rawOffer.merchantCode, 
      rawOffer.merchantName, 
      rawOffer.isOfficial,
      rawOffer.dealUrl
    );

    // 4. Gather other merchant prices for this game for anomaly scoring
    const existingOffers = offerRepo.getOffersForGame(gameId);
    const otherPrices = existingOffers.map(o => o.priceEur);

    // 5. Evaluate Price Anomaly
    const anomalyEval = evaluateOfferAnomaly({
      priceEur: rawOffer.priceEur,
      originalPriceEur: rawOffer.originalPriceEur,
      basePriceEur: knownBasePrice,
      historicalLowEur: rawOffer.historicalLowEur,
      isOfficial: rawOffer.isOfficial,
      merchantTrustScore: merchant.trustScore,
      otherPrices
    });

    // 6. Upsert Offer and Observation
    const offer = offerRepo.upsertOffer({
      gameId,
      merchantId: merchant.id,
      productType: productNorm.productType,
      regionType: regionNorm.regionType,
      regionCode: regionNorm.regionCode,
      regionConfidence: regionNorm.regionConfidence,
      priceEur: rawOffer.priceEur,
      originalPriceEur: rawOffer.originalPriceEur,
      voucherCode: rawOffer.voucherCode,
      dealUrl: rawOffer.dealUrl,
      isValid: true,
      isAnomaly: anomalyEval.isAnomaly,
      anomalyScore: anomalyEval.score,
      anomalyReason: anomalyEval.reason,
      sourceCode,
      rawObservationJson: rawOffer.rawPayload ? JSON.stringify(rawOffer.rawPayload) : undefined
    });

    // 7. Record in Anomaly log if flagged
    if (anomalyEval.isAnomaly && anomalyEval.type) {
      anomalyRepo.record(gameId, offer.id, anomalyEval.type, anomalyEval.score, anomalyEval.reason || 'Anomaly detected');
    }
  }
}

export const syncOrchestrator = new SyncOrchestrator();
