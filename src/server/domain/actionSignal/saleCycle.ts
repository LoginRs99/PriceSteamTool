import type { PriceHistoryEntry } from '../../../shared/types.js';

/**
 * Analyzes price history to extract discount rhythm and cycle frequency
 */
export function analyzeDiscountCycle(
  history: PriceHistoryEntry[] = [],
  basePriceEur?: number,
  typicalMedianEur?: number,
  now: Date = new Date()
): {
  avgDaysBetweenSales?: number;
  daysSinceLastSale?: number;
  isSaleOverdue: boolean;
  saleFrequencyCategory: 'Frequent' | 'Regular' | 'Rare' | 'Unknown';
} {
  if (!history || history.length < 3) {
    return {
      avgDaysBetweenSales: undefined,
      daysSinceLastSale: undefined,
      isSaleOverdue: false,
      saleFrequencyCategory: 'Unknown'
    };
  }

  const basePrice = basePriceEur || Math.max(...history.map(h => h.priceEur));
  const thresholdPrice = typicalMedianEur ? typicalMedianEur * 1.05 : basePrice * 0.85;

  // Sort history chronologically
  const sorted = [...history]
    .filter(h => h.priceEur > 0)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (sorted.length < 2) {
    return {
      avgDaysBetweenSales: undefined,
      daysSinceLastSale: undefined,
      isSaleOverdue: false,
      saleFrequencyCategory: 'Unknown'
    };
  }

  // Identify distinct discount periods
  const saleStartDates: number[] = [];
  let inDiscount = false;
  let lastDiscountEndMs: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const timeMs = new Date(entry.recordedAt).getTime();
    const isDiscounted = entry.priceEur <= thresholdPrice;

    if (isDiscounted && !inDiscount) {
      inDiscount = true;
      saleStartDates.push(timeMs);
    } else if (!isDiscounted && inDiscount) {
      inDiscount = false;
      lastDiscountEndMs = timeMs;
    }
  }

  if (inDiscount) {
    lastDiscountEndMs = now.getTime();
  }

  // Calculate intervals between distinct sales
  const intervalsDays: number[] = [];
  for (let i = 1; i < saleStartDates.length; i++) {
    const diffDays = Math.round((saleStartDates[i] - saleStartDates[i - 1]) / (1000 * 60 * 60 * 24));
    if (diffDays >= 7) { // Filter out micro-jitter within the same promotion
      intervalsDays.push(diffDays);
    }
  }

  let avgDaysBetweenSales: number | undefined = undefined;
  if (intervalsDays.length > 0) {
    intervalsDays.sort((a, b) => a - b);
    const mid = Math.floor(intervalsDays.length / 2);
    avgDaysBetweenSales = intervalsDays.length % 2 !== 0 
      ? intervalsDays[mid] 
      : Math.round((intervalsDays[mid - 1] + intervalsDays[mid]) / 2);
  }

  let daysSinceLastSale: number | undefined = undefined;
  if (lastDiscountEndMs) {
    daysSinceLastSale = Math.max(0, Math.round((now.getTime() - lastDiscountEndMs) / (1000 * 60 * 60 * 24)));
  }

  const isSaleOverdue = Boolean(
    avgDaysBetweenSales && 
    daysSinceLastSale !== undefined && 
    daysSinceLastSale >= avgDaysBetweenSales * 1.15
  );

  let saleFrequencyCategory: 'Frequent' | 'Regular' | 'Rare' | 'Unknown' = 'Unknown';
  if (avgDaysBetweenSales !== undefined) {
    if (avgDaysBetweenSales <= 35) saleFrequencyCategory = 'Frequent';
    else if (avgDaysBetweenSales <= 90) saleFrequencyCategory = 'Regular';
    else saleFrequencyCategory = 'Rare';
  }

  return {
    avgDaysBetweenSales,
    daysSinceLastSale,
    isSaleOverdue,
    saleFrequencyCategory
  };
}
