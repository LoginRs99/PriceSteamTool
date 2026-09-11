import { config } from '../config/index.js';
import { itadAdapter } from '../sources/itad.js';
import { gameRepo } from '../db/repositories/game.js';
import { offerRepo } from '../db/repositories/offer.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';

export class PriceHistoryQueue {
  private inFlight = new Map<string, Promise<boolean>>();
  private isRunningBackground = false;
  private isCancelled = false;

  public isSeedingRunning(): boolean {
    return this.isRunningBackground;
  }

  public cancel(): void {
    if (this.isRunningBackground) {
      this.isCancelled = true;
    }
  }

  /**
   * Seeds historical price data for a single game from ITAD v2.
   * Deduplicates concurrent calls for the same gameId via an in-flight Promise map.
   */
  public async seedGame(gameId: string, options?: { timeoutMs?: number }): Promise<boolean> {
    if (this.inFlight.has(gameId)) {
      return this.inFlight.get(gameId)!;
    }

    const promise = (async () => {
      try {
        const game = gameRepo.getById(gameId);
        if (!game) return false;

        // Skip if already seeded
        if (game.priceHistorySeededAt) {
          return false;
        }

        // Degradation check: ITAD API key must be available
        if (!config.itadApiKey) {
          return false;
        }

        const timeoutMs = options?.timeoutMs ?? 10000;
        const fetchPromise = itadAdapter.fetchPriceHistory(game.steamAppId, game.itadId);

        let points: any[] = [];
        try {
          points = await Promise.race([
            fetchPromise,
            new Promise<any[]>((_, reject) =>
              setTimeout(() => reject(new Error(`ITAD history fetch timeout after ${timeoutMs}ms`)), timeoutMs)
            )
          ]);
        } catch (fetchErr: any) {
          logWarn(`[HistorySeed] Could not fetch ITAD history for "${game.title}" (appId ${game.steamAppId}): ${fetchErr.message}`);
          // Do not permanently mark seeded on network errors/timeouts so it can be retried later
          return false;
        }

        // Write points into price_history and recompute stats
        offerRepo.seedPriceHistoryForGame(game.id, points);
        logInfo(`[HistorySeed] Successfully seeded ${points.length} past price points for "${game.title}"`);
        return true;
      } catch (err: any) {
        logError(`[HistorySeed] Unexpected error seeding game ${gameId}: ${err.message}`);
        return false;
      } finally {
        this.inFlight.delete(gameId);
      }
    })();

    this.inFlight.set(gameId, promise);
    return promise;
  }

  /**
   * Background queue worker that processes all unseeded wishlist games sequentially
   * in order of priority. Non-blocking and paced gently.
   */
  public async startBackgroundSeeding(profileId: string): Promise<void> {
    if (this.isRunningBackground) {
      logInfo('[HistorySeed] Background seeding is already running.');
      return;
    }

    if (!config.itadApiKey) {
      logInfo('[HistorySeed] Background seeding skipped: ITAD_API_KEY not configured.');
      return;
    }

    this.isRunningBackground = true;
    this.isCancelled = false;

    try {
      const unseededGames = gameRepo.getUnseededHistoryWishlistGames(profileId);
      if (unseededGames.length === 0) {
        logInfo('[HistorySeed] All wishlist games already have price history seeded.');
        return;
      }

      logInfo(`[HistorySeed] Starting background price history seeding for ${unseededGames.length} games...`);
      let seededCount = 0;

      for (let i = 0; i < unseededGames.length; i++) {
        if (this.isCancelled) {
          logInfo(`[HistorySeed] Background seeding cancelled at ${i}/${unseededGames.length} games.`);
          break;
        }

        const g = unseededGames[i];
        try {
          const success = await this.seedGame(g.id, { timeoutMs: 15000 });
          if (success) {
            seededCount++;
          }
        } catch (err: any) {
          logWarn(`[HistorySeed] Failed to seed game ${g.title}: ${err.message}`);
        }

        // Paced pause between ITAD calls to avoid rate spikes
        if (i < unseededGames.length - 1 && !this.isCancelled) {
          await new Promise(r => setTimeout(r, 250));
        }
      }

      logInfo(`[HistorySeed] Background price history seeding completed. Seeded ${seededCount} games.`);
    } catch (err: any) {
      logError(`[HistorySeed] Background seeding worker encountered an error: ${err.message}`);
    } finally {
      this.isRunningBackground = false;
      this.isCancelled = false;
    }
  }
}

export const priceHistoryQueue = new PriceHistoryQueue();
