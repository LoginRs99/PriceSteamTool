import type { ConfidenceTier } from '../../../shared/types.js';
import { getConfidenceTier } from './tiers.js';

/**
 * User-facing Multi-Factor Data Confidence Calculation (0 - 100%).
 * This is the primary user-facing Confidence shown throughout the UI and Discord alerts.
 * (For internal pricing risk/anomaly evidence confidence, see pricingEngine:calculateRiskEvidenceConfidence).
 */
export function calculateDataConfidence(input: {
  sampleCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  sourceCount?: number;
}): { confidence: number; tier: ConfidenceTier; factors: Record<string, number> } {
  const n = Math.max(0, input.sampleCount || 0);

  // 1. Sample factor: sqrt(N / 16), capped at 1.0
  const cSample = Math.min(1.0, Math.sqrt(n / 16));

  // 2. Coverage factor: duration in days between first and last observation
  let daysSpan = 0;
  if (input.firstObservedAt && input.lastObservedAt) {
    const tFirst = new Date(input.firstObservedAt).getTime();
    const tLast = new Date(input.lastObservedAt).getTime();
    if (!isNaN(tFirst) && !isNaN(tLast) && tLast >= tFirst) {
      daysSpan = (tLast - tFirst) / (1000 * 3600 * 24);
    }
  }

  let cCoverage = 0.45;
  if (daysSpan >= 180) cCoverage = 1.0;
  else if (daysSpan >= 60) cCoverage = 0.85;
  else if (daysSpan >= 14) cCoverage = 0.65;
  else if (n <= 1) cCoverage = 0.40;

  // 3. Source independence factor
  const sources = Math.max(1, input.sourceCount || 1);
  let cSources = sources >= 2 ? 1.0 : 0.85;

  // 4. Freshness factor
  let cFreshness = 0.85;
  if (input.lastObservedAt) {
    const tLast = new Date(input.lastObservedAt).getTime();
    const hoursSince = (Date.now() - tLast) / (1000 * 3600);
    if (!isNaN(hoursSince)) {
      if (hoursSince <= 36) cFreshness = 1.0;
      else if (hoursSince <= 168) cFreshness = 0.85;
      else cFreshness = 0.55;
    }
  }

  // Combined product
  const rawConfidence = cSample * cCoverage * cSources * cFreshness * 100;
  const confidence = Math.round(Math.max(0, Math.min(100, rawConfidence)));
  const tier = getConfidenceTier(confidence);

  return {
    confidence,
    tier,
    factors: {
      sample: Number(cSample.toFixed(2)),
      coverage: Number(cCoverage.toFixed(2)),
      sources: Number(cSources.toFixed(2)),
      freshness: Number(cFreshness.toFixed(2))
    }
  };
}
