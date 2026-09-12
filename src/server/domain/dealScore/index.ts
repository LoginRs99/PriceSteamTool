export * from './types.js';
export * from './tiers.js';
export * from './confidence.js';
export * from './calculator.js';

/**
 * @deprecated Legacy helper preserved for unit test backward compatibility
 */
export function calculateBaseScore(
  priceEur: number,
  medianPriceEur: number | null | undefined,
  q1PriceEur?: number,
  q3PriceEur?: number
): { baseScore: number; zScore: number; effectiveSigma: number } {
  if (medianPriceEur === null || medianPriceEur === undefined || medianPriceEur <= 0) {
    return { baseScore: 0, zScore: 0, effectiveSigma: 0.30 };
  }
  const iqr = (q1PriceEur !== undefined && q3PriceEur !== undefined)
    ? Math.max(0, q3PriceEur - q1PriceEur)
    : 0;
  const effectiveSigma = Math.max(iqr / 1.349, medianPriceEur * 0.08, 0.30);
  const z = (medianPriceEur - priceEur) / effectiveSigma;
  const zScore = Number(z.toFixed(3));
  const baseScore = 65 / (1 + Math.exp(-1.2 * z));
  return {
    baseScore: Number(baseScore.toFixed(2)),
    zScore,
    effectiveSigma: Number(effectiveSigma.toFixed(3))
  };
}

/**
 * @deprecated Legacy helper preserved for unit test backward compatibility
 */
export function calculateRecordBonus(
  priceEur: number,
  medianPriceEur?: number | null,
  allTimeLowEur?: number | null
): { recordBonus: number; atlDistanceEur?: number } {
  if (allTimeLowEur === undefined || allTimeLowEur === null || allTimeLowEur < 0) {
    return { recordBonus: 0 };
  }

  const atl = allTimeLowEur;
  const median = (medianPriceEur && medianPriceEur > 0) ? medianPriceEur : atl;
  const atlDepthRatio = median > 0 ? Math.max(0, (median - atl) / median) : 0;
  const maxBaseBonusForDepth = 20 * Math.min(1.0, atlDepthRatio / 0.35);

  if (priceEur < atl) {
    const baseBonus = maxBaseBonusForDepth;
    const undercutRatio = atl > 0 ? (atl - priceEur) / atl : 0;
    const maxExtra = (35 - 20) * Math.min(1.0, atlDepthRatio / 0.35);
    const extraUndercutBonus = maxExtra * Math.min(1.0, undercutRatio / 0.20);
    const recordBonus = baseBonus + extraUndercutBonus;
    return {
      recordBonus: Number(recordBonus.toFixed(2)),
      atlDistanceEur: Number((priceEur - atl).toFixed(2))
    };
  }

  if (priceEur === atl) {
    return {
      recordBonus: Number(maxBaseBonusForDepth.toFixed(2)),
      atlDistanceEur: 0
    };
  }

  const span = Math.max(0.30, median - atl);
  const normalizedDistance = (priceEur - atl) / span;

  if (normalizedDistance >= 1.0) {
    return {
      recordBonus: 0,
      atlDistanceEur: Number((priceEur - atl).toFixed(2))
    };
  }

  const proximityRatio = Math.max(0, 1 - normalizedDistance);
  const recordBonus = maxBaseBonusForDepth * Math.pow(proximityRatio, 2);

  return {
    recordBonus: Number(recordBonus.toFixed(2)),
    atlDistanceEur: Number((priceEur - atl).toFixed(2))
  };
}
