import type { DealScoreTier, ConfidenceTier } from '../../../shared/types.js';

/**
 * Classifies Deal Score into qualitative tiers
 */
export function getDealScoreTier(score: number): DealScoreTier {
  if (score >= 80) return 'Exceptional';
  if (score >= 70) return 'Great';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
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
