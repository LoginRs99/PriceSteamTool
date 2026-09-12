import type { PricingErrorInput, PricingErrorEvaluation, PricingErrorType } from './types.js';

export interface TriggeredSignal {
  type: PricingErrorType;
  weight: number;
  reason: string;
}

export function getTriggeredSignals(input: PricingErrorInput): TriggeredSignal[] {
  const price = input.priceEur;
  if (price <= 0 || isNaN(price)) {
    return [];
  }

  const triggered: TriggeredSignal[] = [];
  const freshPeers = (input.otherFreshPricesEur ?? []).filter(
    p => p !== undefined && p !== null && p > 0 && !isNaN(p)
  );
  const msrp = input.steamBasePriceEur ?? input.claimedOriginalPriceEur;
  const minPeer = freshPeers.length > 0 ? Math.min(...freshPeers) : undefined;

  // Reconciled effective ATL
  const atlRaw = input.confirmedAtlEur;
  const med = input.typicalSaleMedianEur;
  let atlEff: number | undefined;
  if (atlRaw !== undefined && med !== undefined) {
    atlEff = Math.min(atlRaw, med);
    // Suspect ATL: if unconfirmed ATL is suspiciously far below typical sale median, raise floor
    if (atlEff < med * 0.15 && input.atlIsConfirmed === false) {
      atlEff = Math.max(atlEff, med * 0.20);
    }
  } else {
    atlEff = atlRaw;
  }

  // Known historic price check: if price is at or above a known confirmed low, it's not a market outlier or glitch
  const isKnownAtl = atlEff !== undefined && atlEff > 0 && price >= (atlEff - 0.05);

  // Signal 1: DECIMAL_SHIFT (0.45)
  // Missing digit pattern: price is ~1/10 (0.08 to 0.12) or ~1/100 (0.008 to 0.012) of MSRP (MSRP >= 30)
  // when all peers are near full price (minPeer >= msrp * 0.60) and game has no history of deep discounts.
  // Or sub-euro glitch (<1.00) on premium title when market is >= 5, or extreme <3% drop on MSRP >= 15
  const isCheapestInMarket = minPeer === undefined || price <= minPeer + 0.02;
  const ratio = (msrp && msrp > 0) ? price / msrp : undefined;

  const isSubEuroGlitch = price <= 1.005 && msrp !== undefined && (
    (msrp >= 10 && (minPeer === undefined || minPeer >= 1.0)) ||
    (msrp >= 5 && price < msrp * 0.05)
  );

  const hasDeepDiscountHistory = (atlEff !== undefined && atlEff <= (msrp ?? 0) * 0.25) ||
    (med !== undefined && med <= (msrp ?? 0) * 0.35);

  const isMissingDigitShift = ratio !== undefined && msrp !== undefined && msrp >= 30 &&
    ((ratio >= 0.08 && ratio <= 0.12) || (ratio >= 0.008 && ratio <= 0.012)) &&
    !hasDeepDiscountHistory &&
    (minPeer === undefined || minPeer >= msrp * 0.60);

  const isExtremeDrop = ratio !== undefined && msrp !== undefined && msrp >= 15 && ratio <= 0.03;

  const isDecimalShift = isCheapestInMarket && !isKnownAtl && (
    isSubEuroGlitch || isMissingDigitShift || isExtremeDrop
  );

  if (isDecimalShift) {
    const anchor = msrp ?? (minPeer ?? 0);
    const reasonText = price <= 1.005
      ? `Sub-euro price glitch (€${price.toFixed(2)} on €${anchor.toFixed(2)} title)`
      : `Suspected decimal shift (€${price.toFixed(2)} vs expected ~€${anchor.toFixed(2)})`;
    triggered.push({
      type: 'DECIMAL_SHIFT',
      weight: 0.45,
      reason: reasonText
    });
  }

  // Signal 2: MARKET_OUTLIER (0.40 multi-peer / 0.25 single-peer)
  // Exclude if price is at/above a known confirmed ATL
  if (!isKnownAtl) {
    if (freshPeers.length === 1) {
      const peer = freshPeers[0];
      if (peer >= 5 && price < peer * 0.25) {
        triggered.push({
          type: 'MARKET_OUTLIER',
          weight: 0.30,
          reason: `Lone market outlier (€${price.toFixed(2)} vs single peer €${peer.toFixed(2)})`
        });
      } else if (price < peer * 0.50) {
        triggered.push({
          type: 'MARKET_OUTLIER',
          weight: 0.25,
          reason: `Lone market outlier (€${price.toFixed(2)} is >50% below single peer €${peer.toFixed(2)})`
        });
      }
    } else if (freshPeers.length >= 2) {
      const sorted = [...freshPeers].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const minP = sorted[0];
      if ((median >= 2.0 && price < median * 0.25) || (price < minP * 0.50)) {
        triggered.push({
          type: 'MARKET_OUTLIER',
          weight: 0.40,
          reason: `Market outlier (€${price.toFixed(2)} vs peer minimum €${minP.toFixed(2)}, median €${median.toFixed(2)})`
        });
      }
    }
  }

  // Signal 3: BELOW_ATL_IMPLAUSIBLE (0.30)
  // Must require confirmed ATL to avoid circularity against untrusted scrapers
  const isAtlConfirmed = input.atlIsConfirmed !== false;
  if (isAtlConfirmed && atlEff !== undefined && atlEff >= 2.0) {
    const threshold = Math.max(atlEff * 0.40, atlEff - Math.max(atlEff * 0.60, 1.00));
    if (price < threshold - 0.005) {
      triggered.push({
        type: 'BELOW_ATL_IMPLAUSIBLE',
        weight: 0.30,
        reason: `Price (€${price.toFixed(2)}) is implausibly far below confirmed all-time low (€${atlEff.toFixed(2)})`
      });
    }
  }

  // Signal 4: EDITION_INVERSION (0.35)
  if (input.suspectedEditionInversion === true) {
    triggered.push({
      type: 'EDITION_INVERSION',
      weight: 0.35,
      reason: `Suspected edition inversion (deluxe/special bundle priced below base edition)`
    });
  }

  // Signal 5: OWN_HISTORY_BREAK (0.25)
  // ownHistoryEur (>=3 entries) IQR/median check
  if (input.ownHistoryEur && input.ownHistoryEur.length >= 3) {
    const sortedHistory = [...input.ownHistoryEur].sort((a, b) => a - b);
    const median = sortedHistory[Math.floor(sortedHistory.length / 2)];
    const q1 = sortedHistory[Math.floor(sortedHistory.length * 0.25)];
    const q3 = sortedHistory[Math.floor(sortedHistory.length * 0.75)];
    const iqr = Math.max(0, q3 - q1);
    const scale = Math.max(iqr / 1.349, median * 0.08, 0.50);
    const z = (median - price) / scale;

    if (z > 2.5) {
      triggered.push({
        type: 'OWN_HISTORY_BREAK',
        weight: 0.25,
        reason: `Price (€${price.toFixed(2)}) severely breaks store's historical distribution (z-score: ${z.toFixed(2)}, median: €${median.toFixed(2)})`
      });
    }
  }

  // Signal 6: FRESH_RELEASE_DROP (0.25)
  // release < 30 days && priceEur < steamBasePriceEur * 0.40
  if (input.gameReleaseDate) {
    const releaseTime = new Date(input.gameReleaseDate).getTime();
    if (!isNaN(releaseTime)) {
      const ageDays = (Date.now() - releaseTime) / (1000 * 3600 * 24);
      const steamBase = input.steamBasePriceEur ?? msrp;
      if (ageDays >= 0 && ((ageDays < 30 && steamBase !== undefined && price < steamBase * 0.40) || (ageDays < 90 && steamBase !== undefined && steamBase >= 40.0 && price < steamBase * 0.25))) {
        triggered.push({
          type: 'FRESH_RELEASE_DROP',
          weight: 0.25,
          reason: `Abnormal price drop (€${price.toFixed(2)} vs Steam base €${steamBase.toFixed(2)}) on fresh release (${Math.round(ageDays)} days old)`
        });
      }
    }
  }

  // Signal 7: FAKE_BASELINE (0.15)
  // claimedOriginalPriceEur > 1.5 * steamBasePriceEur (exempt for delisted/unreleased scarcity)
  if (
    !input.isDelisted &&
    !input.isUnreleased &&
    input.claimedOriginalPriceEur !== undefined &&
    input.steamBasePriceEur !== undefined &&
    input.steamBasePriceEur > 0 &&
    input.claimedOriginalPriceEur > 1.5 * input.steamBasePriceEur
  ) {
    triggered.push({
      type: 'FAKE_BASELINE',
      weight: 0.15,
      reason: `Claimed original price (€${input.claimedOriginalPriceEur.toFixed(2)}) is inflated >1.5x over Steam base price (€${input.steamBasePriceEur.toFixed(2)})`
    });
  }

  return triggered;
}

/**
 * Detects pricing errors using 7 empirical signals and corroboration overrides.
 * Replaces the store-trust-biased risk engine with objective pricing anomaly rules.
 */
export function detectPricingError(input: PricingErrorInput): PricingErrorEvaluation {
  const price = input.priceEur;

  // 1. Early returns: invalid/non-positive price is not a pricing error
  if (price <= 0 || isNaN(price)) {
    return { isLikelyPricingError: false, confidence: 0, type: null, reason: null };
  }

  // 2. Corroboration override:
  // Tightened to +/- 15% (or <= 0.02 EUR for FX rounding; for sub-euro prices, +/- 30% or <= 0.02 EUR)
  const freshPeers = (input.otherFreshPricesEur ?? []).filter(
    p => p !== undefined && p !== null && p > 0 && !isNaN(p)
  );
  const matchingPeers = freshPeers.filter(p => {
    const diff = Math.abs(p - price);
    if (diff <= 0.02) return true;
    if (price <= 1.005) return diff / price <= 0.3001;
    return diff / Math.max(p, price) <= 0.15;
  });

  const isCorroborated =
    (input.independentMerchantCount !== undefined && input.independentMerchantCount >= 2) ||
    matchingPeers.length >= 2 ||
    (matchingPeers.length >= 1 && price <= 1.005);

  if (isCorroborated) {
    return { isLikelyPricingError: false, confidence: 0, type: null, reason: null };
  }

  const triggered = getTriggeredSignals(input);

  // Calculate composite confidence and evaluation
  const totalWeight = triggered.reduce((sum, s) => sum + s.weight, 0);
  const confidence = Math.min(1.0, Math.round(totalWeight * 100) / 100);
  const isLikelyPricingError = confidence >= 0.30;

  if (!isLikelyPricingError || triggered.length === 0) {
    return {
      isLikelyPricingError: false,
      confidence,
      type: null,
      reason: null
    };
  }

  // Sort descending by weight to pick the highest-weight triggered signal
  triggered.sort((a, b) => b.weight - a.weight);
  const primarySignal = triggered[0];

  return {
    isLikelyPricingError: true,
    confidence,
    type: primarySignal.type,
    reason: primarySignal.reason
  };
}
