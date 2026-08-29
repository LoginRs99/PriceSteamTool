import { config } from '../../config/index.js';

export const AKS_BASE_DELAY_MS = config?.delays?.allkeyshop ?? 2000;
export const AKS_MIN_DELAY_MS = config?.delays?.allkeyshop ?? 2000;
export const AKS_MAX_DELAY_MS = Math.max(30000, (config?.delays?.allkeyshop ?? 2000) * 6);

export const AKS_PACING_STEP_DOWN_MS = 250; // Gentle decrease on fast responses
export const AKS_PACING_STEP_UP_MS = 1000;  // Increase on slow responses

/**
 * Latency-aware adaptive delay adjuster:
 * - response < 1s (1000ms): decrease delay toward MIN_DELAY_MS (5000ms)
 * - response 1s-3s (1000ms-3000ms): maintain delay
 * - response > 3s (3000ms): increase delay toward MAX_DELAY_MS (30000ms)
 */
export function computeNextPacingDelay(
  currentDelayMs: number, 
  responseDurationMs: number,
  minDelayMs: number = AKS_MIN_DELAY_MS,
  maxDelayMs: number = AKS_MAX_DELAY_MS
): number {
  if (responseDurationMs < 1000) {
    return Math.max(minDelayMs, currentDelayMs - AKS_PACING_STEP_DOWN_MS);
  } else if (responseDurationMs > 3000) {
    return Math.min(maxDelayMs, currentDelayMs + AKS_PACING_STEP_UP_MS);
  }
  return Math.min(maxDelayMs, Math.max(minDelayMs, currentDelayMs));
}

/**
 * Calculates small bounded jitter to avoid rigid periodic requests (0 to maxJitterMs, default 500ms).
 */
export function calculateBoundedJitter(maxJitterMs = 500, randFn: () => number = Math.random): number {
  if (maxJitterMs <= 0) return 0;
  return Math.floor(randFn() * maxJitterMs);
}
