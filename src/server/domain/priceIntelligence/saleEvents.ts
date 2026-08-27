import type { PriceHistoryEntry, SaleFrequency } from '../../../shared/types.js';

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
