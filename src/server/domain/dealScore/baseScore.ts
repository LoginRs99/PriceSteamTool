import {
  BASE_SCORE_CEILING,
  LOGISTIC_STEEPNESS,
  IQR_TO_SIGMA,
  MIN_SCALE_PCT_OF_MEDIAN,
  ABSOLUTE_MIN_SCALE_EUR
} from './types.js';

/**
 * Stage 1: Median-anchored, Volatility-normalized Base Score (0 - 65)
 * Symmetrical logistic curve: z = 0 -> 32.5 (dead-center Fair)
 */
export function calculateBaseScore(
  priceEur: number,
  medianPriceEur: number | null | undefined,
  q1PriceEur?: number,
  q3PriceEur?: number
): { baseScore: number; zScore: number; effectiveSigma: number } {
  if (medianPriceEur === null || medianPriceEur === undefined || medianPriceEur <= 0) {
    return {
      baseScore: 0,
      zScore: 0,
      effectiveSigma: ABSOLUTE_MIN_SCALE_EUR
    };
  }

  const iqr = (q1PriceEur !== undefined && q3PriceEur !== undefined)
    ? Math.max(0, q3PriceEur - q1PriceEur)
    : 0;

  // Adaptive scale floor: max(IQR / 1.349, 8% of median, 0.30 €)
  const effectiveSigma = Math.max(
    iqr / IQR_TO_SIGMA,
    medianPriceEur * MIN_SCALE_PCT_OF_MEDIAN,
    ABSOLUTE_MIN_SCALE_EUR
  );

  const z = (medianPriceEur - priceEur) / effectiveSigma;
  const zScore = Number(z.toFixed(3));

  // Symmetrical Logistic Curve: z=0 -> 32.5 (Base Score Ceiling = 65)
  const baseScore = BASE_SCORE_CEILING / (1 + Math.exp(-LOGISTIC_STEEPNESS * z));

  return {
    baseScore: Number(baseScore.toFixed(2)),
    zScore,
    effectiveSigma: Number(effectiveSigma.toFixed(3))
  };
}
