/**
 * AllKeyShop Failure Backoff Schedule
 * 
 * failure #1 -> 1 hour
 * failure #2 -> 4 hours
 * failure #3 -> 12 hours
 * failure #4 -> 24 hours
 * failure #5+ -> 48 hours (capped)
 */

export const AKS_FAILURE_SCHEDULE_MS = [
  1 * 60 * 60 * 1000,   // failure #1: 1 hour (3,600,000 ms)
  4 * 60 * 60 * 1000,   // failure #2: 4 hours (14,400,000 ms)
  12 * 60 * 60 * 1000,  // failure #3: 12 hours (43,200,000 ms)
  24 * 60 * 60 * 1000,  // failure #4: 24 hours (86,400,000 ms)
  48 * 60 * 60 * 1000   // failure #5+: 48 hours (172,800,000 ms, capped)
];

export const MAX_FAILURE_BACKOFF_MS = 48 * 60 * 60 * 1000;

/**
 * Computes backoff duration based on consecutive failure count and optional Retry-After header.
 * 
 * Schedule:
 * 1 -> 1h
 * 2 -> 4h
 * 3 -> 12h
 * 4 -> 24h
 * 5+ -> 48h (capped)
 * 
 * If retryAfterSec is provided, the longer cooldown is chosen.
 */
export function computeFailureCooldown(consecutiveFailures: number, retryAfterSec?: number): number {
  if (consecutiveFailures <= 0 && (!retryAfterSec || retryAfterSec <= 0)) {
    return 0;
  }
  const index = Math.max(0, Math.min(consecutiveFailures - 1, AKS_FAILURE_SCHEDULE_MS.length - 1));
  const scheduledMs = consecutiveFailures <= 0 ? 0 : AKS_FAILURE_SCHEDULE_MS[index];
  
  const retryAfterMs = typeof retryAfterSec === 'number' && retryAfterSec > 0 
    ? retryAfterSec * 1000 
    : 0;

  return Math.min(MAX_FAILURE_BACKOFF_MS, Math.max(scheduledMs, retryAfterMs));
}
