import type { DealScoreInput, DealScoreResult, DealVerdict, ShoppingScoreInput } from './types.js';
import { EPSILON_EUR } from '../../../shared/types.js';
import {
  W_ATL,
  ATL_MATCH_BASE,
  ATL_BEAT_BONUS_MAX,
  ATL_BEAT_FULL_UNDERCUT_RATIO,
  W_DISCOUNT,
  W_HISTORY,
  W_MARKET,
  MAX_REALISTIC_DISCOUNT_PCT,
  FAKE_BASELINE_RATIO,
  OWN_MEDIAN_DAMPING_FACTOR,
  SINGLE_OFFER_MARKET_SCORE,
  NO_HISTORY_CAP,
  PROVISIONAL_CAP,
  PROVISIONAL_DEEP_CAP,
  STALE_CAP,
  DATA_SUFFICIENCY_MIN_SAMPLES
} from './types.js';
import { getDealScoreTier } from './tiers.js';
import { calculateDataConfidence } from './confidence.js';

function clamp(val: number, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return min;
  return Math.min(Math.max(val, min), max);
}

/**
 * DealScore v2 Calculator
 * Trust-free scoring using 4 mathematical pillars:
 * 1. S_atl: Proximity to All-Time Low (0 - 40)
 * 2. S_disc: Discount Depth vs Reliable Anchor (0 - 30)
 * 3. S_hist: Historical Sale Distribution Position (0 - 20)
 * 4. S_mkt: Cross-Market Competitiveness (0 - 10)
 */
export function calculateDealScore(input: DealScoreInput): DealScoreResult {
  // Defensive: if pricing error or invalid priceEur, return score 0, verdict 'WAIT'
  if (input.isPricingError || typeof input.priceEur !== 'number' || !Number.isFinite(input.priceEur) || input.priceEur < 0) {
    return {
      score: 0,
      tier: 'Weak',
      verdict: 'WAIT',
      baseScore: 0,
      rarityBonus: 0,
      confidenceScore: 0,
      confidenceTier: 'Low',
      isLowSample: true,
      isProvisional: false,
      components: {
        atlProximity: 0,
        discountDepth: 0,
        historicalValue: 0,
        marketPosition: 0,
        subtotal: 0,
        rawScore: 0
      },
      explanation: {
        medianSavingEur: 0,
        atlDistanceEur: 0,
        confidenceFactors: {}
      }
    };
  }

  const price = input.priceEur;
  const rawAnchor = input.basePriceEur ?? input.originalPriceEur;
  const anchor = (typeof rawAnchor === 'number' && Number.isFinite(rawAnchor) && rawAnchor > 0) ? rawAnchor : undefined;

  const rawAtl = (input.isOfficialStore === true && input.officialHistoricalLowEur !== undefined && input.officialHistoricalLowEur !== null && input.officialHistoricalLowEur > 0)
    ? input.officialHistoricalLowEur
    : (input.allTimeLowEur ?? input.historicalLowEur ?? input.low1yEur);
  const atlRaw = (typeof rawAtl === 'number' && Number.isFinite(rawAtl) && rawAtl >= 0) ? rawAtl : undefined;

  const rawMed = input.typicalSaleMedianEur;
  const med = (typeof rawMed === 'number' && Number.isFinite(rawMed) && rawMed > 0) ? rawMed : undefined;

  // Reconcile ATL with typical sale median: ATL cannot exceed the typical sale median, and heal unconfirmed glitch ATL
  let atl: number | undefined;
  if (atlRaw !== undefined) {
    if (med !== undefined) {
      atl = Math.min(atlRaw, med);
      // If ATL is suspiciously far below median AND from unconfirmed/single source, use median * 0.20 as floor
      if (atl < med * 0.15 && (input.isConfirmedAtl === false || input.isSingleSourceLow === true)) {
        atl = Math.max(atl, med * 0.20);
      }
    } else {
      atl = atlRaw;
    }
  } else {
    atl = undefined;
  }

  // Pillar 1: S_atl (ATL Proximity: 0 - 40)
  // At confirmed ATL (price == atl), awards up to ATL_MATCH_BASE (36 points),
  // scaled by how deep the ATL is below MSRP anchor (dampened when ATL == MSRP so never-discounted games don't score 36).
  // Undercutting confirmed ATL awards up to ATL_BEAT_BONUS_MAX (+4 points, maxing at 20% undercut).
  let S_atl = 0;
  if (atl !== undefined && atl !== null) {
    let bandTop: number;
    let atlDepthFactor = 1.0;

    if (input.isDelisted) {
      bandTop = med ? Math.max(med, atl * 1.5) : atl * 2;
      atlDepthFactor = 1.0;
    } else if (input.isUnreleased) {
      bandTop = anchor ?? (atl * 1.25);
      atlDepthFactor = 0.0;
    } else if (anchor !== undefined && anchor !== null && anchor > 0) {
      // Normal game with MSRP anchor
      bandTop = Math.max(anchor, atl);
      const atlDiscountRatio = (anchor - atl) / anchor;
      if (price < atl) {
        // Genuinely beating ATL (new record low) -> full weight
        atlDepthFactor = 1.0;
      } else if (atlDiscountRatio <= EPSILON_EUR) {
        // Never discounted: ATL is at or above MSRP and price merely matches it (HoneySelect / LET IT DIE case)
        atlDepthFactor = 0.0;
      } else {
        // Continuous ramp: full weight when ATL is at least 10% below MSRP (e.g. Factorio 10% rare sale)
        // and smoothly scales down to 0 when ATL approaches MSRP
        atlDepthFactor = clamp(atlDiscountRatio / 0.10, 0, 1);
      }
    } else {
      // Missing MSRP: fall back to implied retail upper bound
      bandTop = atl * 2;
      atlDepthFactor = 1.0;
    }

    const band = Math.max(bandTop - atl, atl * 0.25, 0.01);
    const baseAtlScore = ATL_MATCH_BASE * atlDepthFactor * (1 - clamp((price - atl) / band, 0, 1));
    const beatBonus = (atl > 0 && price < atl)
      ? ATL_BEAT_BONUS_MAX * clamp((atl - price) / (atl * ATL_BEAT_FULL_UNDERCUT_RATIO), 0, 1)
      : 0;
    S_atl = baseAtlScore + beatBonus;
    if (input.isConfirmedAtl === false || input.isSingleSourceLow === true) {
      S_atl *= 0.5;
    }
  }

  // Pillar 2: S_disc (Discount Depth: 0 - 30)
  // v2.4.0 (ADR-3): scored relative to the game's OWN typical_sale_median
  // when available, not a one-size-fits-all curve over raw MSRP — see
  // OWN_MEDIAN_DAMPING_FACTOR doc comment in types.ts for the empirical
  // rationale (validated on 15 real games, negative correlation between
  // median/MSRP ratio and how over-rewarded the old formula was).
  let discountPct = 0;
  let S_disc = 0;
  if (!input.isDelisted && !input.isUnreleased && anchor !== undefined && anchor !== null && anchor > 0 && price >= 0) {
    if (input.basePriceEur !== undefined && input.originalPriceEur !== undefined && input.originalPriceEur > FAKE_BASELINE_RATIO * input.basePriceEur) {
      // Fake baseline: ignore claimed original
      discountPct = 0;
      S_disc = 0;
    } else {
      const discountFrac = clamp((anchor - price) / anchor, 0, 1);
      discountPct = discountFrac * 100;

      if (med !== undefined && med !== null && med > 0) {
        const discountAtMed = clamp((anchor - med) / anchor, 0, 1);
        const effectiveDiscountAtMed = discountAtMed >= 0.10 ? discountAtMed : discountAtMed * 0.5;
        const baseScoreAtMed = W_DISCOUNT * OWN_MEDIAN_DAMPING_FACTOR * Math.pow(effectiveDiscountAtMed, 0.75);

        if (price >= med) {
          // At/above this game's own normal sale price -> heavily dampened;
          // reaching an "ordinary" price for THIS title isn't a notable event,
          // even if it looks like a deep cut against raw MSRP.
          const effectiveDiscount = discountFrac >= 0.10 ? discountFrac : discountFrac * 0.5;
          S_disc = W_DISCOUNT * OWN_MEDIAN_DAMPING_FACTOR * Math.pow(effectiveDiscount, 0.75);
        } else {
          // Genuinely below this game's own normal sale price -> full weight.
          // Continuous monotonic transition: starts from baseScoreAtMed at price == med
          // and smoothly climbs to W_DISCOUNT (30) as price approaches zero.
          const fracBelowOwnMedian = clamp((med - price) / med, 0, 1);
          S_disc = baseScoreAtMed + (W_DISCOUNT - baseScoreAtMed) * Math.pow(fracBelowOwnMedian, 0.75);
        }
      } else {
        // No historical median yet (new/rarely-tracked game) -> fall back to
        // the original MSRP-only formula unchanged.
        const effectiveDiscount = discountFrac >= 0.10 ? discountFrac : discountFrac * 0.5;
        S_disc = W_DISCOUNT * Math.pow(effectiveDiscount, 0.75);
      }
    }
  }

  // Pillar 3: S_hist (Historical Sale Distribution: 0 - 20)
  let S_hist = 0;
  if (med !== undefined && med !== null) {
    if (price > med) {
      S_hist = 0;
    } else {
      const atlRef = atl ?? 0;
      const spread = med - atlRef;
      if (spread < 0.01) {
        // If the only known historic level is full MSRP (no discount ever) and price is at/above MSRP, S_hist is 0
        if (anchor !== undefined && anchor > 0 && med >= anchor - 0.01 && price >= med - 0.01) {
          S_hist = 0;
        } else {
          // Price is at or below the only known historic sale level (or beating full MSRP)
          S_hist = W_HISTORY;
        }
      } else {
        S_hist = W_HISTORY * (1 - clamp((price - atlRef) / spread, 0, 1));
      }
    }
  }

  // Pillar 4: S_mkt (Cross-Market Position: 0 - 10)
  const offersCount = input.offersCount ?? (input.otherOfferCount !== undefined ? input.otherOfferCount + 1 : 1);
  let S_mkt = SINGLE_OFFER_MARKET_SCORE;
  if (offersCount <= 1 && input.isOfficialStore === true) {
    S_mkt = 7; // Official store single offer gets higher market confidence
  } else if (offersCount > 1) {
    const rawMin = input.minOfferEur ?? input.marketMinPriceEur;
    const rawMax = input.maxOfferEur;
    const mktMin = (typeof rawMin === 'number' && Number.isFinite(rawMin) && rawMin >= 0) ? rawMin : price;
    const mktMax = (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 0) ? Math.max(rawMax, mktMin) : Math.max(mktMin, price);
    const spread = Math.max(0, mktMax - mktMin);
    if (spread <= 0.02) {
      // All offers are within FX rounding tolerance (everyone matches market low)
      S_mkt = W_MARKET;
    } else {
      S_mkt = W_MARKET * (1 - clamp((price - mktMin) / spread, 0, 1));
    }
  }

  // Raw score: S_raw = S_atl + S_disc + S_hist + S_mkt
  const S_raw = S_atl + S_disc + S_hist + S_mkt;
  let score = S_raw;

  // History presence and sample count
  const hasSomeHistory = (atl !== undefined && atl !== null) || (med !== undefined && med !== null) || ((input.sampleCount ?? 0) > 0);
  const sampleCount = input.sampleCount !== undefined ? input.sampleCount : (hasSomeHistory ? 5 : 0);
  const isProvisional = !hasSomeHistory || sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES;

  // Caps applied in sequence:
  // 1. Data sufficiency: if sampleCount < DATA_SUFFICIENCY_MIN_SAMPLES (or no history at all):
  //    if discountPct >= 60 → PROVISIONAL_DEEP_CAP (80, or 85 for official stores with known MSRP),
  //    else if has some history → PROVISIONAL_CAP (65),
  //    else if no history at all → NO_HISTORY_CAP (40).
  if (isProvisional) {
    if (discountPct >= 60) {
      const deepCap = (input.isOfficialStore === true && anchor !== undefined && anchor > 0)
        ? Math.min(PROVISIONAL_DEEP_CAP + 5, 85)
        : PROVISIONAL_DEEP_CAP;
      score = Math.min(score, deepCap);
    } else if (hasSomeHistory) {
      score = Math.min(score, PROVISIONAL_CAP);
    } else {
      score = Math.min(score, NO_HISTORY_CAP);
    }
  }

  // 2. Stale history: continuous ramp down to STALE_CAP (50) for stale prices
  if (input.isStalePrice) {
    score = Math.min(score, STALE_CAP);
  } else if (input.daysSinceLastSample !== undefined && input.daysSinceLastSample > 60) {
    const t = clamp((input.daysSinceLastSample - 60) / (180 - 60), 0, 1);
    const staleCap = 100 - t * (100 - STALE_CAP);
    score = Math.min(score, staleCap);
  }

  // 3. Score 100 reservation: cap at 99 unless price beats confirmed ATL by >= 5%
  // ATL age decay: if the historical low record is older than 730 days (2 years), require a deeper >=25% undercut
  let atlAgeDays = 0;
  if (input.historicalLowDate || input.firstObservedAt) {
    const rawDate = input.historicalLowDate || input.firstObservedAt;
    const tAtl = new Date(rawDate!).getTime();
    if (!isNaN(tAtl) && tAtl < Date.now()) {
      atlAgeDays = (Date.now() - tAtl) / (1000 * 3600 * 24);
    }
  }
  const minUndercutPct = atlAgeDays > 730 ? 0.75 : 0.95;
  const beatsConfirmedAtlBy5Pct =
    input.isConfirmedAtl === true &&
    input.isSingleSourceLow !== true &&
    atl !== undefined &&
    atl > 0 &&
    price <= (atl * minUndercutPct + 0.0001);

  let finalScore = Math.round(clamp(score, 0, 100));
  if (finalScore >= 100 && !beatsConfirmedAtlBy5Pct) {
    finalScore = 99;
  }

  // Verdict / tier mapping: 0-39 WAIT, 40-59 FAIR, 60-79 GOOD, 80-100 BUY
  let verdict: DealVerdict;
  if (!input.isDelisted && !input.isUnreleased && anchor !== undefined && anchor > 0 && price > anchor + EPSILON_EUR) {
    verdict = 'OVERPRICED';
  } else if (finalScore >= 80) {
    verdict = 'INSTANT_BUY';
  } else if (finalScore >= 60) {
    verdict = 'GREAT_DEAL';
  } else if (finalScore >= 40) {
    verdict = 'FAIR_DEAL';
  } else {
    verdict = 'WAIT';
  }

  const effectiveSampleCount = input.sampleCount ?? (hasSomeHistory ? 5 : 0);
  const confidenceData = calculateDataConfidence({
    sampleCount: effectiveSampleCount,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    sourceCount: input.sourceCount ?? 1
  });

  const tier = getDealScoreTier(finalScore);

  const medianSavingEur = med !== undefined && med !== null
    ? Number((med - price).toFixed(2))
    : 0;

  const atlDistanceEur = atl !== undefined && atl !== null
    ? Number((price - atl).toFixed(2))
    : 0;

  const shoppingScore = calculateShoppingScore({
    dealScore: finalScore,
    isOfficial: Boolean(input.isOfficialStore),
    basePriceEur: anchor,
    currentPriceEur: price,
    typicalSaleMedianEur: med,
    historicalLowEur: atl,
    confidenceScore: confidenceData.confidence
  });

  return {
    score: finalScore,
    tier,
    verdict,
    baseScore: Number(S_disc.toFixed(2)),
    rarityBonus: Number(S_atl.toFixed(2)),
    confidenceScore: confidenceData.confidence,
    confidenceTier: confidenceData.tier,
    isLowSample: confidenceData.confidence < 40,
    isProvisional,
    components: {
      atlProximity: Number(S_atl.toFixed(2)),
      discountDepth: Number(S_disc.toFixed(2)),
      historicalValue: Number(S_hist.toFixed(2)),
      marketPosition: Number(S_mkt.toFixed(2)),
      subtotal: finalScore,
      rawScore: Number(S_raw.toFixed(2))
    },
    explanation: {
      medianSavingEur,
      atlDistanceEur,
      confidenceFactors: confidenceData.factors
    },
    shoppingScore
  };
}

/**
 * Calculates credible absolute cash savings in EUR against a trustworthy reference price.
 * Bounded against typical sale median (median * 1.6) to prevent inflated MSRP distortion.
 * Returns 0 if current price is invalid or reference price is missing/unreliable.
 */
export function calculateCredibleSavings(
  currentPriceEur?: number | null,
  basePriceEur?: number | null,
  typicalSaleMedianEur?: number | null
): number {
  if (currentPriceEur === undefined || currentPriceEur === null || currentPriceEur <= 0) {
    return 0;
  }
  let refPrice = (basePriceEur && basePriceEur > 0) ? basePriceEur : undefined;
  if (typicalSaleMedianEur && typicalSaleMedianEur > 0) {
    if (refPrice && refPrice > typicalSaleMedianEur) {
      refPrice = Math.min(refPrice, typicalSaleMedianEur * 1.6);
    } else {
      refPrice = typicalSaleMedianEur;
    }
  }
  if (!refPrice || refPrice <= currentPriceEur) {
    return 0;
  }
  return Number((refPrice - currentPriceEur).toFixed(2));
}

/**
 * Multi-Dimensional Price Opportunity Score (0 - 100)
 *
 * Dedicated to ranking personal wishlist games by genuine price attractiveness:
 * 1. Base: Pure mathematical Deal Score v2.4 (0 - 100)
 * 2. Authentic Reference Price & Real Absolute Savings:
 *    Calculates cash saved vs credible historical reference price (protects against inflated MSRP).
 *    Awards a logarithmic utility bonus (up to +7.0 pts for saving €20 - €50+)
 *    without letting expensive games artificially monopolize the view.
 * 3. Market Competitiveness Edge:
 *    Awards +2 to +5 pts if the winning store significantly undercuts competing stores (>=15% cheaper).
 * 4. Persistent Historical Low Standing:
 *    Awards +3 pts when an offer is sitting at or within 2% of the verified record low.
 * 5. Data Confidence Guard:
 *    Dampens provisional 1-sample or unverified single-source observations.
 *
 * ZERO store bias (official stores and keyshops compete on 100% equal terms).
 * ZERO external game-quality bias (Metacritic and review scores do not affect the ranking).
 */
export function calculateShoppingScore(input: ShoppingScoreInput): number {
  const {
    dealScore,
    basePriceEur,
    currentPriceEur,
    typicalSaleMedianEur,
    historicalLowEur,
    competingPriceEur,
    confidenceScore
  } = input;

  if (dealScore <= 0 || currentPriceEur <= 0) return 0;

  // 1. Authentic Reference Price for Savings
  const savingsEur = calculateCredibleSavings(currentPriceEur, basePriceEur, typicalSaleMedianEur);

  // 2. Absolute Savings Utility Bonus (logarithmic)
  let savingsBonus = 0;
  if (savingsEur > 0) {
    savingsBonus = Math.min(7.0, Math.log10(Math.max(1, savingsEur)) * 3.0);
  }

  // 3. Current Market Competitiveness Edge (Unusual retailer undercut)
  let marketEdgeBonus = 0;
  if (competingPriceEur && competingPriceEur > currentPriceEur) {
    const undercutRatio = (competingPriceEur - currentPriceEur) / competingPriceEur;
    if (undercutRatio >= 0.15) {
      marketEdgeBonus = Math.min(5.0, undercutRatio * 8.0);
    }
  }

  // 4. Proximity to Historical Record Low (Persistent attractiveness)
  let recordLowBonus = 0;
  if (historicalLowEur && historicalLowEur > 0 && currentPriceEur <= historicalLowEur * 1.02) {
    recordLowBonus = 3.0;
  }

  // 5. Data Confidence Factor
  const conf = confidenceScore ?? 50;
  const confFactor = 0.92 + 0.08 * (conf / 100);

  const raw = (dealScore * confFactor) + savingsBonus + marketEdgeBonus + recordLowBonus;
  return Math.round(Math.min(100, Math.max(0, raw)));
}
