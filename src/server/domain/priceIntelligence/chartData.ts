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
  const points: PriceChartPoint[] = history
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
  return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
