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

  // Signal 1: DECIMAL_SHIFT (0.45)
  // steamBasePriceEur >= 10 && priceEur < steamBasePriceEur * 0.10, OR (priceEur < 1.0 && steamBasePriceEur >= 10 && otherFreshPricesEur min >= 5)
  // Also catches extreme sub-euro / sub-5% glitches on titles with MSRP
  const isCheapestInMarket = minPeer === undefined || price <= minPeer;
  const isDecimalShift = isCheapestInMarket && (
    (msrp !== undefined && msrp >= 10 && price <= msrp * 0.10) ||
    (price < 1.0 && msrp !== undefined && msrp >= 10 && minPeer !== undefined && minPeer >= 5) ||
    (price < 1.0 && msrp !== undefined && price < msrp * 0.05)
  );

  if (isDecimalShift) {
    const anchor = msrp ?? (minPeer ?? 0);
    const reasonText = price < 1.00
      ? `Sub-euro price glitch (€${price.toFixed(2)} on €${anchor.toFixed(2)} title)`
      : `Suspected decimal shift (€${price.toFixed(2)} vs expected ~€${anchor.toFixed(2)})`;
    triggered.push({
      type: 'DECIMAL_SHIFT',
      weight: 0.45,
      reason: reasonText
    });
  }

  // Signal 2: MARKET_OUTLIER (0.40 multi-peer / 0.25 single-peer)
  // if otherFreshPricesEur >= 2, median(peers) >= 5 && priceEur < median * 0.25 -> 0.40.
  // If exactly 1 peer, peer >= 5 && priceEur < peer * 0.25 -> 0.25
  if (freshPeers.length === 1) {
    const peer = freshPeers[0];
    if (peer >= 5 && price < peer * 0.25) {
      triggered.push({
        type: 'MARKET_OUTLIER',
        weight: 0.25,
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
    if ((median >= 5 && price < median * 0.25) || (median >= 2.0 && price < median * 0.25) || (price < minP * 0.50)) {
      triggered.push({
        type: 'MARKET_OUTLIER',
        weight: 0.40,
        reason: `Market outlier (€${price.toFixed(2)} vs peer minimum €${minP.toFixed(2)}, median €${median.toFixed(2)})`
      });
    }
  }

  // Signal 3: BELOW_ATL_IMPLAUSIBLE (0.30)
  // confirmedAtlEur >= 5 && priceEur < confirmedAtlEur * 0.50
  const atl = input.confirmedAtlEur;
  if (atl !== undefined && ((atl >= 5.0 && price < (atl * 0.50) - 0.005) || (atl >= 2.0 && price < (atl * 0.30) - 0.005))) {
    triggered.push({
      type: 'BELOW_ATL_IMPLAUSIBLE',
      weight: 0.30,
      reason: `Price (€${price.toFixed(2)}) is implausibly far below confirmed all-time low (€${atl.toFixed(2)})`
    });
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
    const scale = Math.max(iqr / 1.349, median * 0.03, 0.01);
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
      if (ageDays >= 0 && ((ageDays < 30 && steamBase !== undefined && price < steamBase * 0.40) || (ageDays < 90 && steamBase !== undefined && steamBase >= 30.0 && price < steamBase * 0.30))) {
        triggered.push({
          type: 'FRESH_RELEASE_DROP',
          weight: 0.25,
          reason: `Abnormal price drop (€${price.toFixed(2)} vs Steam base €${steamBase.toFixed(2)}) on fresh release (${Math.round(ageDays)} days old)`
        });
      }
    }
  }

  // Signal 7: FAKE_BASELINE (0.15)
  // claimedOriginalPriceEur > 1.5 * steamBasePriceEur
  if (
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
  // If >= 2 independent merchants have a fresh price within +/- 40% of priceEur -> not an error
  const freshPeers = (input.otherFreshPricesEur ?? []).filter(
    p => p !== undefined && p !== null && p > 0 && !isNaN(p)
  );
  const matchingPeers = freshPeers.filter(
    p => Math.abs(p - price) / price <= 0.40
  );

  const isCorroborated =
    (input.independentMerchantCount !== undefined && input.independentMerchantCount >= 2) ||
    matchingPeers.length >= 2 ||
    (matchingPeers.length >= 1 && (input.independentMerchantCount === undefined || input.independentMerchantCount >= 2));

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
