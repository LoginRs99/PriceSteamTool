import type {
  PriceHistoryEntry,
  Offer,
  Game,
  PriceChartData,
  PriceChartPoint
} from '../../../shared/types.js';
import { isTrustedHistoryEntry } from './types.js';

/**
 * Price Chart Data Builder with Lightweight Downsampling
 */
export function buildPriceChartData(
  game: Game,
  history: PriceHistoryEntry[],
  currentBestOffer?: Offer,
  typicalSaleMedian?: number | null
): PriceChartData {
  // Create timeline points from trusted history
  const rawPoints: PriceChartPoint[] = history
    .filter(h => isTrustedHistoryEntry(h) && !isNaN(new Date(h.recordedAt).getTime()))
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
    rawPoints.push({
      timestamp: nowIso,
      priceEur: Number(currentBestOffer.priceEur.toFixed(2)),
      merchantName: currentBestOffer.merchantName || 'Store',
      isOfficial: currentBestOffer.isOfficial,
      discountPercent: currentBestOffer.discountPercent || 0,
      priceEvent: currentBestOffer.priceEvent,
      dealScore: currentBestOffer.dealScore
    });
  }

  // Aggregate daily minimum points: one point per day representing the best trusted deal of that day
  const dailyPointsMap = new Map<string, PriceChartPoint>();
  for (const p of rawPoints) {
    const day = p.timestamp.slice(0, 10);
    const existing = dailyPointsMap.get(day);
    if (!existing) {
      dailyPointsMap.set(day, p);
    } else {
      if (p.priceEur < existing.priceEur) {
        dailyPointsMap.set(day, p);
      } else if (p.priceEur === existing.priceEur) {
        if (!existing.isOfficial && p.isOfficial) {
          dailyPointsMap.set(day, p);
        } else if ((p.dealScore ?? 0) > (existing.dealScore ?? 0)) {
          dailyPointsMap.set(day, p);
        }
      }
    }
  }

  const points = Array.from(dailyPointsMap.values());
  points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Downsample to max 150 points if large history
  let finalPoints = points;
  if (points.length > 200) {
    finalPoints = downsamplePoints(points, 150);
  }

  // Calculate bounds with defense against inverted or uninitialized bounds
  let minPrice = (typeof game.historicalLowEur === 'number' && Number.isFinite(game.historicalLowEur) && game.historicalLowEur > 0)
    ? game.historicalLowEur
    : (finalPoints[0]?.priceEur || 0);
  let maxPrice = (typeof game.basePriceEur === 'number' && Number.isFinite(game.basePriceEur) && game.basePriceEur > 0)
    ? game.basePriceEur
    : (finalPoints[0]?.priceEur || 10);

  for (const p of finalPoints) {
    if (p.priceEur < minPrice) minPrice = p.priceEur;
    if (p.priceEur > maxPrice) maxPrice = p.priceEur;
  }

  if (minPrice > maxPrice) {
    const tmp = minPrice;
    minPrice = maxPrice;
    maxPrice = tmp;
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

export const calculatePriceChartData = buildPriceChartData;

/**
 * Helper: simple min/max interval downsampling preserving peaks and valleys
 */
function downsamplePoints(points: PriceChartPoint[], targetCount: number): PriceChartPoint[] {
  if (targetCount <= 2 || points.length <= targetCount) return points;
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
  return result.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}
