/**
 * Adaptive Scheduling & Due-Filtering for AllKeyShop Pacing
 */

export const PRICE_TOLERANCE_EUR = 0.05;
export const FLOOR_HOURS = 24;
export const CEILING_HOURS = 48; // Must be strictly less than 72h (FRESHNESS_WINDOW)

/**
 * Recomputes the check interval and unchanged streak for a game after an AllKeyShop fetch.
 * 
 * - If price changed (or first check), resets to FLOOR_HOURS (24h) and streak 0.
 * - If price unchanged, streak increments and interval doubles up to CEILING_HOURS (14d).
 * - If the game has an active target price, interval is capped to FLOOR_HOURS (24h).
 */
export function computeNextInterval(
  prevPrice: number | null,
  newPrice: number | null,
  streak: number,
  prevIntervalHours: number,
  hasActiveTargetPrice: boolean
): { intervalHours: number; streak: number } {
  const changed = prevPrice === null || newPrice === null || Math.abs(prevPrice - newPrice) > PRICE_TOLERANCE_EUR;
  if (changed) {
    return { intervalHours: FLOOR_HOURS, streak: 0 };
  }
  const nextStreak = streak + 1;
  const grownHours = Math.min(CEILING_HOURS, prevIntervalHours * 2);
  return { intervalHours: hasActiveTargetPrice ? FLOOR_HOURS : grownHours, streak: nextStreak };
}

/**
 * Evaluates whether a game is due for an AllKeyShop refresh.
 * Unchecked / brand new games are due immediately.
 */
export function isAllkeyshopDue(
  game: { allkeyshopLastCheckedAt?: string; allkeyshopCheckIntervalHours?: number },
  now = Date.now()
): boolean {
  if (!game.allkeyshopLastCheckedAt) return true;
  const lastCheckedMs = new Date(game.allkeyshopLastCheckedAt).getTime();
  if (isNaN(lastCheckedMs)) return true;
  const intervalHours = game.allkeyshopCheckIntervalHours ?? FLOOR_HOURS;
  return (now - lastCheckedMs) >= intervalHours * 3600_000;
}

/**
 * Computes a priority score for a game to determine enrichment queue order.
 * Higher score = higher priority to scrape first.
 *
 * Factors:
 * 1. Brand new / never checked games: +10,000 pts (must establish baseline)
 * 2. Active Target Price: +5,000 pts (user waiting for price drop)
 * 3. Steam Top 50 Wishlist priority: +3,000 pts (user's most desired games)
 * 4. Wishlist rank penalty: -priority (e.g. rank 1 loses 1 pt, rank 1000 loses 1000 pts)
 * 5. Elapsed time overdue bonus: +10 pts per overdue hour
 */
export function computeWishlistScrapePriority(
  game: {
    allkeyshopLastCheckedAt?: string;
    allkeyshopCheckIntervalHours?: number;
    targetPriceEur?: number;
    priority?: number;
  },
  now = Date.now()
): number {
  let score = 0;

  // Never checked games should be prioritized
  if (!game.allkeyshopLastCheckedAt) {
    score += 10000;
  }

  // Active target price
  if (game.targetPriceEur !== undefined && game.targetPriceEur !== null) {
    score += 5000;
  }

  // Steam wishlist priority
  const rank = typeof game.priority === 'number' && game.priority > 0 ? game.priority : 9999;
  if (rank <= 50) {
    score += 3000;
  }
  score -= rank; // higher wishlist rank = slightly higher score

  // Overdue urgency
  if (game.allkeyshopLastCheckedAt) {
    const lastCheckedMs = new Date(game.allkeyshopLastCheckedAt).getTime();
    if (!isNaN(lastCheckedMs)) {
      const intervalMs = (game.allkeyshopCheckIntervalHours ?? FLOOR_HOURS) * 3600_000;
      const overdueHours = Math.max(0, (now - lastCheckedMs - intervalMs) / 3600_000);
      score += Math.round(overdueHours * 10);
    }
  }

  return score;
}

