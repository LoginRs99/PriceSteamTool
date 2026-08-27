import type { DealScoreTier, ConfidenceTier } from '../../../shared/types.js';

/**
 * Classifies Deal Score into qualitative tiers
 */
export function getDealScoreTier(score: number): DealScoreTier {
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Great';
  if (score >= 55) return 'Good';
  if (score >= 35) return 'Fair';
  return 'Weak';
}

/**
 * Classifies Confidence into qualitative tiers
 */
export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 80) return 'High';
  if (confidence >= 60) return 'Medium';
  if (confidence >= 40) return 'Moderate';
  return 'Low';
}
