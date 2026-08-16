import type { 
  PriceHistoryEntry, 
  Offer, 
  Game,
  PeriodLowEntry, 
  TypicalSalePrice, 
  MarketComparison, 
  SaleFrequency, 
  PriceVolatility, 
  PurchaseAdvice, 
  PriceChartData, 
  PriceChartPoint,
  PriceIntelligenceResponse,
  PriceEventType
} from '../../shared/types.js';
import { calculateDealScore } from './dealScore.js';
import { generateActionSignal } from './actionSignal.js';

export interface PriceIntelligenceInput {
  game: Game;
  offers: Offer[];
  history: PriceHistoryEntry[];
}

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
  const trustedHistory = history.filter(h => h.priceEur > 0);

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

    return {
      priceEur: Number(best.price.toFixed(2)),
      merchantName: best.merchant,
      recordedAt: best.date,
      isOfficial: best.isOfficial,
      observationCount: obsCount,
      isExactPeriodData: true
    };
  };

  // Confirmed ATL calculation
  let confirmedAtlEur = game.historicalLowEur;
  let atlSource = game.historicalLowSource || 'Recorded low';
  let atlDate = game.historicalLowDate;
  let isConfirmed = true;

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

/**
 * 2. Typical Sale Price with Statistical IQR Outlier Protection
 * Considers discounted history points without rigid 10% cutoff, filtering outliers via IQR.
 */
export function calculateTypicalSalePrice(
  basePriceEur: number | undefined,
  history: PriceHistoryEntry[]
): TypicalSalePrice {
  if (!basePriceEur || basePriceEur <= 0) {
    return {
      medianPriceEur: null,
      sampleCount: 0,
      isLowConfidence: true
    };
  }

  // Filter candidate sale points: discount >= 15% OR price <= 85% of MSRP
  const saleThreshold = basePriceEur * 0.85;
  const candidates = history
    .filter(h => h.priceEur > 0 && (h.priceEur <= saleThreshold || (h.discountPercent && h.discountPercent >= 15)))
    .map(h => h.priceEur);

  if (candidates.length === 0) {
    return {
      medianPriceEur: null,
      sampleCount: 0,
      isLowConfidence: true
    };
  }

  if (candidates.length < 3) {
    // 1 or 2 points: simple median
    candidates.sort((a, b) => a - b);
    const mid = Math.floor(candidates.length / 2);
    const median = candidates.length % 2 !== 0 
      ? candidates[mid] 
      : (candidates[mid - 1] + candidates[mid]) / 2;

    return {
      medianPriceEur: Number(median.toFixed(2)),
      sampleCount: candidates.length,
      isLowConfidence: true
    };
  }

  // Calculate Q1, Q3, and IQR for outlier removal
  candidates.sort((a, b) => a - b);
  const q1Index = Math.floor(candidates.length * 0.25);
  const q3Index = Math.floor(candidates.length * 0.75);
  const q1 = candidates[q1Index];
  const q3 = candidates[q3Index];
  const iqr = q3 - q1;

  // Tukey's fences: filter out extreme lower outliers (e.g. glitches far below IQR)
  const lowerBound = q1 - 1.5 * iqr;
  const cleanCandidates = candidates.filter(p => p >= lowerBound);
  const finalPool = cleanCandidates.length > 0 ? cleanCandidates : candidates;

  const mid = Math.floor(finalPool.length / 2);
  const median = finalPool.length % 2 !== 0 
    ? finalPool[mid] 
    : (finalPool[mid - 1] + finalPool[mid]) / 2;

  const finalQ1 = finalPool[Math.floor(finalPool.length * 0.25)];
  const finalQ3 = finalPool[Math.floor(finalPool.length * 0.75)];

  return {
    medianPriceEur: Number(median.toFixed(2)),
    q1PriceEur: Number(finalQ1.toFixed(2)),
    q3PriceEur: Number(finalQ3.toFixed(2)),
    sampleCount: finalPool.length,
    isLowConfidence: false
  };
}

/**
 * 3. Sale Event Grouping & Drop Frequency
 * Groups consecutive observations into distinct sale events with explicit MSRP termination and 14-day gap rule.
 */
export function groupSaleEvents(
  basePriceEur: number | undefined,
  history: PriceHistoryEntry[]
): SaleFrequency {
  if (!basePriceEur || basePriceEur <= 0 || history.length === 0) {
    return {
      saleEventsLast12m: 0,
      avgDaysBetweenSales: undefined,
      frequencyCategory: 'Rare'
    };
  }

  const nowMs = Date.now();
  const oneYearAgoMs = nowMs - 365 * 24 * 60 * 60 * 1000;
  const saleThreshold = basePriceEur * 0.85;
  const normalThreshold = basePriceEur * 0.90;

  // Sort history ascending by time
  const sorted = [...history]
    .filter(h => !isNaN(new Date(h.recordedAt).getTime()))
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  interface SaleEvent {
    startMs: number;
    endMs: number;
    minPrice: number;
  }

  const events: SaleEvent[] = [];
  let currentEvent: SaleEvent | null = null;
  let lastObservationMs = 0;

  for (const point of sorted) {
    const pointMs = new Date(point.recordedAt).getTime();
    const isSale = point.priceEur <= saleThreshold || (point.discountPercent && point.discountPercent >= 15);
    const isNormal = point.priceEur >= normalThreshold;

    if (isSale) {
      if (!currentEvent) {
        // Start new sale event
        currentEvent = {
          startMs: pointMs,
          endMs: pointMs,
          minPrice: point.priceEur
        };
      } else {
        const gapDays = (pointMs - lastObservationMs) / (1000 * 60 * 60 * 24);
        if (gapDays <= 14) {
          // Continue current sale event
          currentEvent.endMs = pointMs;
          currentEvent.minPrice = Math.min(currentEvent.minPrice, point.priceEur);
        } else {
          // Gap > 14 days without bridge: close current and start new
          events.push(currentEvent);
          currentEvent = {
            startMs: pointMs,
            endMs: pointMs,
            minPrice: point.priceEur
          };
        }
      }
    } else if (isNormal) {
      if (currentEvent) {
        // Explicit return to normal price always closes current sale event
        events.push(currentEvent);
        currentEvent = null;
      }
    }

    lastObservationMs = pointMs;
  }

  if (currentEvent) {
    events.push(currentEvent);
  }

  // Filter events in the last 12 months
  const recentEvents = events.filter(e => e.startMs >= oneYearAgoMs);
  const count = recentEvents.length;

  let avgDays: number | undefined = undefined;
  if (count >= 2) {
    let totalDaysBetween = 0;
    for (let i = 1; i < recentEvents.length; i++) {
      totalDaysBetween += (recentEvents[i].startMs - recentEvents[i - 1].startMs) / (1000 * 60 * 60 * 24);
    }
    avgDays = Math.round(totalDaysBetween / (count - 1));
  }

  let frequencyCategory: 'Frequent' | 'Regular' | 'Rare' = 'Rare';
  if (count >= 6 || (avgDays !== undefined && avgDays <= 60)) {
    frequencyCategory = 'Frequent';
  } else if (count >= 3 || (avgDays !== undefined && avgDays <= 120)) {
    frequencyCategory = 'Regular';
  }

  return {
    saleEventsLast12m: count,
    avgDaysBetweenSales: avgDays,
    frequencyCategory
  };
}

/**
 * 4. Price Volatility (Daily Best Trusted Price series)
 * Measures CV and price change frequency strictly on observed days without synthetic jumps.
 */
export function calculatePriceVolatility(
  history: PriceHistoryEntry[],
  currentBestOffer?: Offer
): PriceVolatility {
  // Group observations into daily minimums
  const dailyMap = new Map<string, number>();

  for (const h of history) {
    if (h.priceEur > 0) {
      const day = h.recordedAt.slice(0, 10);
      const existing = dailyMap.get(day);
      if (existing === undefined || h.priceEur < existing) {
        dailyMap.set(day, h.priceEur);
      }
    }
  }

  if (currentBestOffer && currentBestOffer.priceEur > 0) {
    const today = (currentBestOffer.lastObservedAt || currentBestOffer.fetchedAt).slice(0, 10);
    const existing = dailyMap.get(today);
    if (existing === undefined || currentBestOffer.priceEur < existing) {
      dailyMap.set(today, currentBestOffer.priceEur);
    }
  }

  const sortedDays = Array.from(dailyMap.keys()).sort();
  const prices = sortedDays.map(d => dailyMap.get(d)!);

  if (prices.length < 2) {
    return {
      score: 0.0,
      category: 'Stable',
      rawCv: 0.0,
      priceChangesCount: 0
    };
  }

  // Calculate mean and standard deviation
  const n = prices.length;
  const mean = prices.reduce((a, b) => a + b, 0) / n;
  const variance = prices.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const rawCv = mean > 0 ? stdDev / mean : 0;

  // Count price changes >= 5% strictly between consecutive OBSERVED days
  let changesCount = 0;
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && Math.abs(curr - prev) / prev >= 0.05) {
      changesCount++;
    }
  }

  // Normalized score 0.0 to 1.0
  const score = Number(Math.min(1.0, rawCv * 2.0).toFixed(2));

  let category: 'Stable' | 'Moderate' | 'Volatile' = 'Moderate';
  if (rawCv < 0.12 && changesCount <= 2) {
    category = 'Stable';
  } else if (rawCv > 0.30 || changesCount > 6) {
    category = 'Volatile';
  }

  return {
    score,
    category,
    rawCv: Number(rawCv.toFixed(3)),
    priceChangesCount: changesCount
  };
}

/**
 * 5. Price vs Market Comparison
 * Compares current price against active compatible non-anomaly offers.
 */
export function calculateMarketComparison(
  offers: Offer[],
  currentBestOffer?: Offer
): MarketComparison {
  // Filter compatible, valid, non-anomaly offers
  const compatible = offers.filter(o => 
    o.isValid && 
    !o.isAnomaly && 
    o.riskLevel !== 'HIGH' &&
    ['GLOBAL', 'EU', 'HU'].includes(o.regionType) &&
    o.priceEur > 0
  );

  if (compatible.length === 0) {
    const p = currentBestOffer?.priceEur || 0;
    return {
      marketMedianEur: p,
      minOfficialPriceEur: currentBestOffer?.isOfficial ? p : undefined,
      minTrustedPriceEur: p,
      totalCompatibleOffers: currentBestOffer ? 1 : 0,
      currentRank: 1,
      percentBelowMarketMedian: 0
    };
  }

  const prices = compatible.map(o => o.priceEur).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 !== 0 
    ? prices[mid] 
    : (prices[mid - 1] + prices[mid]) / 2;

  const officialOffers = compatible.filter(o => o.isOfficial);
  const minOfficial = officialOffers.length > 0 
    ? Math.min(...officialOffers.map(o => o.priceEur)) 
    : undefined;

  const trustedOffers = compatible.filter(o => o.riskLevel === 'SAFE' || o.riskLevel === 'LOW');
  const minTrusted = trustedOffers.length > 0 
    ? Math.min(...trustedOffers.map(o => o.priceEur)) 
    : undefined;

  const currentPrice = currentBestOffer?.priceEur || prices[0];
  let rank = 1;
  for (let i = 0; i < prices.length; i++) {
    if (currentPrice > prices[i]) {
      rank++;
    }
  }

  const percentBelow = median > 0 && currentPrice < median
    ? Number((((median - currentPrice) / median) * 100).toFixed(1))
    : 0;

  return {
    marketMedianEur: Number(median.toFixed(2)),
    minOfficialPriceEur: minOfficial ? Number(minOfficial.toFixed(2)) : undefined,
    minTrustedPriceEur: minTrusted ? Number(minTrusted.toFixed(2)) : undefined,
    totalCompatibleOffers: compatible.length,
    currentRank: rank,
    percentBelowMarketMedian: percentBelow
  };
}

/**
 * 6. Buy / Fair / Wait Decision Engine with Precedence & Safety Guard
 */
export function evaluatePurchaseAdvice(
  game: Game,
  currentBestOffer: Offer | undefined,
  periodLows: PriceIntelligenceResponse['periodLows'],
  typicalSale: TypicalSalePrice
): PurchaseAdvice {
  const currentPrice = currentBestOffer?.priceEur ?? game.bestPriceEur ?? 0;
  const basePrice = game.basePriceEur ?? currentBestOffer?.originalPriceEur ?? 0;
  const discount = currentBestOffer?.discountPercent ?? game.bestDiscountPercent ?? 0;
  const dealScore = currentBestOffer?.dealScore ?? game.bestDealScore ?? 0;
  const atl = periodLows.allTimeLow.priceEur;

  // 1. Minimum Data Insufficiency Gate
  const hasNoSaleHistory = typicalSale.medianPriceEur === null;
  const hasNoConfirmedDrop = !periodLows.allTimeLow.isConfirmed || periodLows.allTimeLow.priceEur >= currentPrice;

  if (hasNoSaleHistory && hasNoConfirmedDrop && discount === 0) {
    return {
      decision: 'WAIT',
      confidence: 'LOW',
      headline: 'Insufficient Price History',
      reasoning: [
        'No historical sales or confirmed record lows recorded yet for this game.',
        `Current offer is at full MSRP (€${currentPrice.toFixed(2)}).`
      ]
    };
  }

  // 2. High Risk / Anomaly Safety Guard
  if (currentBestOffer && (currentBestOffer.isAnomaly || currentBestOffer.riskLevel === 'HIGH')) {
    return {
      decision: 'WAIT',
      confidence: 'HIGH',
      headline: 'High Risk Price Anomaly',
      reasoning: [
        'Current offer is flagged as an unverified pricing error or high-risk seller.',
        currentBestOffer.anomalyReason || 'Price is an extreme outlier.'
      ]
    };
  }

  // 3. BUY Rule (First match wins)
  const isAtOrBelowATL = atl > 0 && currentPrice <= (atl + 0.05);
  const isDeepTypicalSale = typicalSale.medianPriceEur !== null && currentPrice <= (typicalSale.medianPriceEur * 0.85);
  const isHighDealScore = dealScore >= 80;

  if (isAtOrBelowATL || isDeepTypicalSale || isHighDealScore) {
    const reasons: string[] = [];
    if (isAtOrBelowATL) {
      reasons.push(`Matches confirmed All-Time Low price (€${atl.toFixed(2)}).`);
    }
    if (isDeepTypicalSale && typicalSale.medianPriceEur) {
      const diffPct = Math.round(((typicalSale.medianPriceEur - currentPrice) / typicalSale.medianPriceEur) * 100);
      reasons.push(`${diffPct}% below the typical sale price of €${typicalSale.medianPriceEur.toFixed(2)}.`);
    }
    if (isHighDealScore) {
      reasons.push(`Exceptional Deal Score of ${dealScore}/100.`);
    }

    return {
      decision: 'BUY',
      confidence: 'HIGH',
      headline: 'Exceptional Buying Opportunity',
      reasoning: reasons.length > 0 ? reasons : ['Outstanding price relative to historical anchors.']
    };
  }

  // 4. FAIR Rule
  const isWithinTypicalBand = typicalSale.medianPriceEur !== null && 
    currentPrice <= (typicalSale.medianPriceEur * 1.10) && 
    currentPrice >= (typicalSale.medianPriceEur * 0.85);

  const isDecentSale = discount >= 30 && dealScore >= 50;
  const isNear90dLow = periodLows.low90d.priceEur !== null && 
    currentPrice <= (periodLows.low90d.priceEur * 1.05) &&
    discount >= 25 &&
    (typicalSale.medianPriceEur === null || currentPrice <= typicalSale.medianPriceEur * 1.15);

  if (isWithinTypicalBand || isDecentSale || isNear90dLow) {
    const reasons: string[] = [];
    if (isWithinTypicalBand && typicalSale.medianPriceEur) {
      reasons.push(`Consistent with the typical sale price of €${typicalSale.medianPriceEur.toFixed(2)}.`);
    }
    if (isDecentSale) {
      reasons.push(`Good discount of -${discount}% with solid deal rating.`);
    }
    if (isNear90dLow && periodLows.low90d.priceEur) {
      reasons.push(`Near the 90-day low of €${periodLows.low90d.priceEur.toFixed(2)}.`);
    }

    return {
      decision: 'FAIR',
      confidence: 'MEDIUM',
      headline: 'Fair Sale Price',
      reasoning: reasons.length > 0 ? reasons : ['Fair market price for this title.']
    };
  }

  // 5. WAIT Fallback
  const waitReasons: string[] = [];
  if (discount === 0 && basePrice > 0) {
    waitReasons.push(`Currently at full MSRP (€${basePrice.toFixed(2)}).`);
  } else if (discount > 0 && discount < 20) {
    waitReasons.push(`Minor discount of only -${discount}%.`);
  }
  if (typicalSale.medianPriceEur !== null && currentPrice > typicalSale.medianPriceEur * 1.15) {
    const diffPct = Math.round(((currentPrice - typicalSale.medianPriceEur) / typicalSale.medianPriceEur) * 100);
    waitReasons.push(`Current price is ${diffPct}% higher than typical sale price (€${typicalSale.medianPriceEur.toFixed(2)}).`);
  }

  return {
    decision: 'WAIT',
    confidence: 'MEDIUM',
    headline: 'Wait for Better Discount',
    reasoning: waitReasons.length > 0 ? waitReasons : ['Wait for deeper seasonal discount.']
  };
}

/**
 * 7. Price Chart Data Builder with Lightweight Downsampling
 */
export function buildPriceChartData(
  game: Game,
  history: PriceHistoryEntry[],
  currentBestOffer?: Offer,
  typicalSaleMedian?: number | null
): PriceChartData {
  // Create timeline points
  const points: PriceChartPoint[] = history
    .filter(h => h.priceEur > 0 && !isNaN(new Date(h.recordedAt).getTime()))
    .map(h => ({
      timestamp: h.recordedAt,
      priceEur: Number(h.priceEur.toFixed(2)),
      merchantName: h.merchantName || 'Store',
      isOfficial: Boolean(h.isOfficial),
      discountPercent: h.discountPercent || 0,
      priceEvent: h.priceEvent,
      dealScore: h.dealScore
    }));

  // Append current observation if available
  if (currentBestOffer && currentBestOffer.priceEur > 0) {
    const nowIso = new Date().toISOString();
    points.push({
      timestamp: nowIso,
      priceEur: Number(currentBestOffer.priceEur.toFixed(2)),
      merchantName: currentBestOffer.merchantName || 'Store',
      isOfficial: currentBestOffer.isOfficial,
      discountPercent: currentBestOffer.discountPercent || 0,
      priceEvent: currentBestOffer.priceEvent,
      dealScore: currentBestOffer.dealScore
    });
  }

  points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Downsample to max 150 points if large history
  let finalPoints = points;
  if (points.length > 200) {
    finalPoints = downsamplePoints(points, 150);
  }

  // Calculate bounds
  let minPrice = game.historicalLowEur ?? (finalPoints[0]?.priceEur || 0);
  let maxPrice = game.basePriceEur ?? (finalPoints[0]?.priceEur || 10);

  for (const p of finalPoints) {
    if (p.priceEur < minPrice) minPrice = p.priceEur;
    if (p.priceEur > maxPrice) maxPrice = p.priceEur;
  }

  const startDate = finalPoints.length > 0 ? finalPoints[0].timestamp : new Date().toISOString();
  const endDate = finalPoints.length > 0 ? finalPoints[finalPoints.length - 1].timestamp : new Date().toISOString();

  return {
    points: finalPoints,
    basePriceEur: game.basePriceEur,
    historicalLowEur: game.historicalLowEur,
    typicalSaleMedianEur: typicalSaleMedian || undefined,
    minPrice: Number(minPrice.toFixed(2)),
    maxPrice: Number(maxPrice.toFixed(2)),
    startDate,
    endDate
  };
}

/**
 * Helper: simple min/max interval downsampling preserving peaks and valleys
 */
function downsamplePoints(points: PriceChartPoint[], targetCount: number): PriceChartPoint[] {
  if (points.length <= targetCount) return points;
  const result: PriceChartPoint[] = [points[0]];
  const bucketSize = (points.length - 2) / (targetCount - 2);

  for (let i = 0; i < targetCount - 2; i++) {
    const start = Math.floor(1 + i * bucketSize);
    const end = Math.min(points.length - 1, Math.floor(1 + (i + 1) * bucketSize));
    let minPoint = points[start];
    let maxPoint = points[start];

    for (let j = start; j < end; j++) {
      if (points[j].priceEur < minPoint.priceEur) minPoint = points[j];
      if (points[j].priceEur > maxPoint.priceEur) maxPoint = points[j];
    }

    if (minPoint === maxPoint) {
      result.push(minPoint);
    } else {
      result.push(minPoint);
      result.push(maxPoint);
    }
  }

  result.push(points[points.length - 1]);
  return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * 8. Consolidated Price Intelligence Generator
 */
export function generatePriceIntelligence(input: PriceIntelligenceInput): PriceIntelligenceResponse {
  const { game, offers, history } = input;
  const bestOffer = offers.find(o => o.isBestDeal) || offers[0];

  const periodLows = calculatePeriodLows(game, history, bestOffer);
  const typicalSale = calculateTypicalSalePrice(game.basePriceEur, history);
  const marketComparison = calculateMarketComparison(offers, bestOffer);
  const frequency = groupSaleEvents(game.basePriceEur, history);
  const volatility = calculatePriceVolatility(history, bestOffer);
  const advice = evaluatePurchaseAdvice(game, bestOffer, periodLows, typicalSale);
  const chartData = buildPriceChartData(game, history, bestOffer, typicalSale.medianPriceEur);

  // Generate factual historical summary
  const currentPrice = bestOffer?.priceEur ?? game.bestPriceEur ?? 0;
  const summaryParts: string[] = [];
  summaryParts.push(`Current price is €${currentPrice.toFixed(2)}.`);

  if (periodLows.allTimeLow.priceEur && currentPrice <= periodLows.allTimeLow.priceEur + 0.05) {
    summaryParts.push('Matches confirmed all-time low.');
  }
  if (typicalSale.medianPriceEur !== null) {
    if (currentPrice < typicalSale.medianPriceEur) {
      const pct = Math.round(((typicalSale.medianPriceEur - currentPrice) / typicalSale.medianPriceEur) * 100);
      summaryParts.push(`${pct}% below typical sale price (€${typicalSale.medianPriceEur.toFixed(2)}).`);
    } else if (currentPrice > typicalSale.medianPriceEur * 1.05) {
      const pct = Math.round(((currentPrice - typicalSale.medianPriceEur) / typicalSale.medianPriceEur) * 100);
      summaryParts.push(`${pct}% above typical sale price (€${typicalSale.medianPriceEur.toFixed(2)}).`);
    } else {
      summaryParts.push(`Matches typical sale price (€${typicalSale.medianPriceEur.toFixed(2)}).`);
    }
  }

  const freshDealCalc = calculateDealScore({
    priceEur: currentPrice,
    basePriceEur: game.basePriceEur,
    typicalSaleMedianEur: typicalSale.medianPriceEur,
    typicalSaleQ1Eur: typicalSale.q1PriceEur,
    typicalSaleQ3Eur: typicalSale.q3PriceEur,
    isLowSample: typicalSale.isLowConfidence || typicalSale.medianPriceEur === null,
    low90dEur: periodLows.low90d.priceEur,
    low1yEur: periodLows.low1y.priceEur,
    allTimeLowEur: periodLows.allTimeLow.priceEur || game.historicalLowEur,
    historicalLowEur: periodLows.allTimeLow.priceEur || game.historicalLowEur
  });

  const actionSignal = generateActionSignal({
    dealScore: bestOffer?.dealScore ?? game.bestDealScore ?? freshDealCalc.score,
    confidenceScore: game.bestConfidenceScore ?? (freshDealCalc.confidenceScore ?? 50),
    isProvisional: Boolean(game.bestIsProvisional ?? freshDealCalc.isProvisional),
    isAnomaly: bestOffer?.isAnomaly ?? false,
    currentPriceEur: currentPrice,
    basePriceEur: game.basePriceEur,
    typicalSaleMedianEur: typicalSale.medianPriceEur || undefined,
    typicalSaleQ1Eur: typicalSale.q1PriceEur,
    typicalSaleQ3Eur: typicalSale.q3PriceEur,
    typicalSaleSampleCount: typicalSale.sampleCount,
    historicalLowEur: periodLows.allTimeLow.priceEur || game.historicalLowEur,
    low90dEur: periodLows.low90d.priceEur || undefined,
    history
  });

  return {
    gameId: game.id,
    currentPrice: {
      priceEur: currentPrice,
      basePriceEur: game.basePriceEur,
      discountPercent: bestOffer?.discountPercent ?? game.bestDiscountPercent ?? 0,
      merchantName: bestOffer?.merchantName || 'Steam',
      isOfficial: bestOffer?.isOfficial ?? true,
      dealScore: bestOffer?.dealScore ?? game.bestDealScore ?? freshDealCalc.score,
      dealTier: bestOffer?.dealTier ?? game.bestDealTier ?? freshDealCalc.tier
    },
    periodLows,
    typicalSale,
    marketComparison,
    frequency,
    volatility,
    advice,
    actionSignal,
    historicalContextSummary: summaryParts.join(' '),
    chartData
  };
}
