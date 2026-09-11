export type SteamReviewSentiment = 'positive' | 'mixed' | 'negative';

/**
 * Derives Steam user review sentiment category from percentage.
 * Steam thresholds: positive >= 70%, mixed >= 40%, otherwise negative.
 */
export function getSteamReviewSentiment(percent?: number | null): SteamReviewSentiment {
  if (percent == null) return 'negative';
  if (percent >= 70) return 'positive';
  if (percent >= 40) return 'mixed';
  return 'negative';
}
