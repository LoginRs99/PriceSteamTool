import {
  RECORD_BONUS_AT_ATL,
  RECORD_BONUS_MAX,
  ATL_FULL_DEPTH_RATIO,
  UNDERCUT_FULL_DEPTH_RATIO
} from './types.js';

/**
 * Stage 2: Continuous Relative Record Bonus (0 - 35)
 * Scaled by ATL depth below median & progressive bonus for deeper undercuts below old ATL.
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

  // 1. Calculate ATL depth below median: how significant is this ATL?
  const atlDepthRatio = median > 0 ? Math.max(0, (median - atl) / median) : 0;
  // If ATL is very shallow (< 1% below median), base bonus is appropriately scaled
  const maxBaseBonusForDepth = RECORD_BONUS_AT_ATL * Math.min(1.0, atlDepthRatio / ATL_FULL_DEPTH_RATIO);

  // 2. Case A: Price is strictly below ATL (New Record / Undercutting previous ATL)
  if (priceEur < atl) {
    const baseBonus = maxBaseBonusForDepth;
    const undercutRatio = atl > 0 ? (atl - priceEur) / atl : 0;
    const maxExtra = (RECORD_BONUS_MAX - RECORD_BONUS_AT_ATL) * Math.min(1.0, atlDepthRatio / ATL_FULL_DEPTH_RATIO);
    const extraUndercutBonus = maxExtra * Math.min(1.0, undercutRatio / UNDERCUT_FULL_DEPTH_RATIO);
    
    const recordBonus = baseBonus + extraUndercutBonus;
    return {
      recordBonus: Number(recordBonus.toFixed(2)),
      atlDistanceEur: Number((priceEur - atl).toFixed(2))
    };
  }

  // 3. Case B: Price exactly matches ATL (Reaching existing record)
  if (priceEur === atl) {
    return {
      recordBonus: Number(maxBaseBonusForDepth.toFixed(2)),
      atlDistanceEur: 0
    };
  }

  // 4. Case C: Approaching ATL from above: smooth quadratic decay to 0 at median
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

