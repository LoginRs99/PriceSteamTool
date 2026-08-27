import type {
  PriceHistoryEntry,
  Offer,
  Game,
  PeriodLowEntry,
  PriceIntelligenceResponse
} from '../../../shared/types.js';
import { isTrustedHistoryEntry, isKeyshopSourceStr } from './types.js';

/**
 * 1. Rolling Period Lows (7d, 30d, 90d, 1y) & Confirmed ATL
 * Strictly adheres to trusted-only scope and handles insufficient history without synthetic fallback.
 */
export function calculatePeriodLows(
  game: Game,
  history: PriceHistoryEntry[],
  currentBestOffer?: Offer
): PriceIntelligenceResponse['periodLows'] {
  const now = new Date();
  const nowMs = now.getTime();

  // Filter trusted history points (non-anomaly, valid)
  const trustedHistory = history.filter(isTrustedHistoryEntry);

  // Find oldest timestamp in history
  let oldestTimestampMs = nowMs;
  for (const h of trustedHistory) {
    const t = new Date(h.recordedAt).getTime();
    if (!isNaN(t) && t < oldestTimestampMs) {
      oldestTimestampMs = t;
    }
  }

  const historySpanDays = (nowMs - oldestTimestampMs) / (1000 * 60 * 60 * 24);

  // Helper to compute low in a given day window
  const computeWindowLow = (days: number): PeriodLowEntry => {
    const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
    
    // Check if we have observations within the window
    const windowObservations = trustedHistory.filter(h => {
      const t = new Date(h.recordedAt).getTime();
      return !isNaN(t) && t >= cutoffMs && t <= nowMs;
    });

    // Also include current best offer if valid & within trusted scope
    const candidatePrices: { price: number; merchant?: string; date?: string; isOfficial?: boolean }[] = windowObservations.map(h => ({
      price: h.priceEur,
      merchant: h.merchantName,
      date: h.recordedAt,
      isOfficial: h.isOfficial
    }));

    if (currentBestOffer && currentBestOffer.priceEur > 0 && currentBestOffer.riskLevel !== 'HIGH' && !currentBestOffer.isAnomaly) {
      candidatePrices.push({
        price: currentBestOffer.priceEur,
        merchant: currentBestOffer.merchantName,
        date: currentBestOffer.lastObservedAt || currentBestOffer.fetchedAt,
        isOfficial: currentBestOffer.isOfficial
      });
    }

    const obsCount = candidatePrices.length;

    // For 7-day low: any observation within 7d is considered exact
    // For 30d, 90d, 365d: require that the history span covers at least 70% of the period window
    const hasSufficientSpan = days <= 7 ? obsCount > 0 : historySpanDays >= (days * 0.70);

    if (obsCount === 0 || !hasSufficientSpan) {
      return {
        priceEur: null,
        merchantName: undefined,
        recordedAt: undefined,
        isOfficial: undefined,
        observationCount: obsCount,
        isExactPeriodData: false
      };
    }

    // Find minimum price entry
    let best = candidatePrices[0];
    for (let i = 1; i < candidatePrices.length; i++) {
      if (candidatePrices[i].price < best.price) {
        best = candidatePrices[i];
      }
    }

    // Check if best (lowest) price is single-source unofficial (keyshop) without corroboration
    let isSingleSourceLow = false;
    if (best.isOfficial === false) {
      const minP = best.price * 0.85;
      const maxP = best.price * 1.15;
      const corroborations = candidatePrices.filter(c => 
        c !== best && 
        c.price >= minP && 
        c.price <= maxP && 
        (c.merchant !== best.merchant || c.isOfficial === true)
      );
      if (corroborations.length === 0) {
        isSingleSourceLow = true;
      }
    }

    return {
      priceEur: Number(best.price.toFixed(2)),
      merchantName: best.merchant,
      recordedAt: best.date,
      isOfficial: best.isOfficial,
      observationCount: obsCount,
      isExactPeriodData: true,
      isSingleSourceLow: isSingleSourceLow ? true : undefined
    };
  };

  // Confirmed ATL calculation
  let confirmedAtlEur = game.historicalLowEur;
  let atlSource = game.historicalLowSource || 'Recorded low';
  let atlDate = game.historicalLowDate;
  let isConfirmed = false;

  if ((game as any).atlIsConfirmed !== undefined && (game as any).atlIsConfirmed !== null) {
    isConfirmed = Boolean((game as any).atlIsConfirmed);
  } else if ((game as any).atl_is_confirmed !== undefined && (game as any).atl_is_confirmed !== null) {
    isConfirmed = Boolean((game as any).atl_is_confirmed);
  } else if (confirmedAtlEur !== undefined && confirmedAtlEur !== null) {
    // If no explicit confirmation flag was persisted, only non-keyshop/store fronts are tentatively confirmed
    isConfirmed = !isKeyshopSourceStr(atlSource);
  }

  if (confirmedAtlEur === undefined || confirmedAtlEur === null) {
    if (trustedHistory.length > 0) {
      let minPrice = trustedHistory[0].priceEur;
      let minDate = trustedHistory[0].recordedAt;
      for (const h of trustedHistory) {
        if (h.priceEur < minPrice) {
          minPrice = h.priceEur;
          minDate = h.recordedAt;
        }
      }
      confirmedAtlEur = minPrice;
      atlDate = minDate;
      isConfirmed = false;
    } else if (currentBestOffer && currentBestOffer.priceEur > 0) {
      confirmedAtlEur = currentBestOffer.priceEur;
      atlDate = currentBestOffer.fetchedAt;
      isConfirmed = false;
    } else {
      confirmedAtlEur = game.basePriceEur || 0;
      isConfirmed = false;
    }
  } else {
    // If ATL source points to a keyshop or ATL was unconfirmed, check if genuine corroboration is met in trusted history
    if (isKeyshopSourceStr(atlSource) || !isConfirmed) {
      const minP = confirmedAtlEur * 0.85;
      const maxP = confirmedAtlEur * 1.15;
      const corroboratingHistory = trustedHistory.filter(h =>
        h.priceEur >= minP &&
        h.priceEur <= maxP &&
        (h.isOfficial === true || (h.merchantName && h.merchantName !== atlSource))
      );
      if (corroboratingHistory.length > 0) {
        isConfirmed = true;
      } else if (isKeyshopSourceStr(atlSource)) {
        isConfirmed = false;
      }
    }
  }

  return {
    low7d: computeWindowLow(7),
    low30d: computeWindowLow(30),
    low90d: computeWindowLow(90),
    low1y: computeWindowLow(365),
    allTimeLow: {
      priceEur: Number(confirmedAtlEur.toFixed(2)),
      recordedAt: atlDate,
      source: atlSource,
      isConfirmed
    }
  };
}
