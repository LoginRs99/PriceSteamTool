/**
 * Adaptive Scheduling & Due-Filtering for AllKeyShop Pacing
 */

export const PRICE_TOLERANCE_EUR = 0.05;
export const FLOOR_HOURS = 24;
export const CEILING_HOURS = 168; // 7 days

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
