import type { 
  ActionDecision, 
  ActionSignal, 
  PriceHistoryEntry, 
  Game 
} from '../../shared/types.js';

export interface ActionSignalInput {
  dealScore: number;
  confidenceScore: number;
  isProvisional: boolean;
  isAnomaly: boolean;
  currentPriceEur: number;
  basePriceEur?: number;
  typicalSaleMedianEur?: number;
  typicalSaleQ1Eur?: number;
  typicalSaleQ3Eur?: number;
  typicalSaleSampleCount?: number;
  historicalLowEur?: number;
  low90dEur?: number;
  history?: PriceHistoryEntry[];
  currentDate?: Date;
}

/**
 * Known Steam Major Seasonal Sales approximate calendar dates
 */
const STEAM_SEASONAL_SALES = [
  { name: 'Steam Spring Sale', month: 2, day: 14 },     // March ~14
  { name: 'Steam Summer Sale', month: 5, day: 25 },     // June ~25
  { name: 'Steam Autumn Sale', month: 10, day: 25 },    // November ~25
  { name: 'Steam Winter Sale', month: 11, day: 18 }     // December ~18
];

/**
 * Checks if a major Steam Seasonal Sale is approaching within the next window of days
 */
export function getUpcomingSteamSale(now: Date = new Date()): { 
  name: string; 
  daysUntil: number; 
  isImminent: boolean 
} | null {
  const currentYear = now.getFullYear();
  let closestEvent: { name: string; targetDate: Date; daysUntil: number } | null = null;

  for (const year of [currentYear, currentYear + 1]) {
    for (const sale of STEAM_SEASONAL_SALES) {
      const targetDate = new Date(year, sale.month, sale.day);
      const diffMs = targetDate.getTime() - now.getTime();
      const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysUntil >= 0) {
        if (!closestEvent || daysUntil < closestEvent.daysUntil) {
          closestEvent = { name: sale.name, targetDate, daysUntil };
        }
      }
    }
  }

  if (!closestEvent) return null;

  return {
    name: closestEvent.name,
    daysUntil: closestEvent.daysUntil,
    isImminent: closestEvent.daysUntil <= 14
  };
}

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

/**
 * Generates actionable buying advice (Action Signal) combining:
 * 1. Deal Score & Data Confidence
 * 2. All-Time Low proximity
 * 3. Empirical Sale Cycle Rhythm
 * 4. Upcoming Steam Major Seasonal Events
 */
export function generateActionSignal(input: ActionSignalInput): ActionSignal {
  const now = input.currentDate || new Date();
  const {
    dealScore,
    confidenceScore,
    isProvisional,
    isAnomaly,
    currentPriceEur,
    basePriceEur,
    typicalSaleMedianEur,
    typicalSaleQ1Eur,
    historicalLowEur,
    typicalSaleSampleCount = 0,
    history = []
  } = input;

  const upcomingEvent = getUpcomingSteamSale(now);
  const cycleInfo = analyzeDiscountCycle(history, basePriceEur, typicalSaleMedianEur, now);

  // Expected Next Sale Target computation
  let expectedSaleTargetEur: number | undefined = undefined;
  let expectedSaleMinEur: number | undefined = undefined;
  let expectedSaleMaxEur: number | undefined = undefined;

  if (typicalSaleMedianEur && typicalSaleMedianEur > 0) {
    expectedSaleTargetEur = Number(typicalSaleMedianEur.toFixed(2));
    expectedSaleMinEur = Number((typicalSaleQ1Eur || historicalLowEur || typicalSaleMedianEur * 0.85).toFixed(2));
    expectedSaleMaxEur = Number(typicalSaleMedianEur.toFixed(2));
  } else if (basePriceEur && basePriceEur > 0) {
    expectedSaleTargetEur = Number((basePriceEur * 0.5).toFixed(2));
    expectedSaleMinEur = Number((basePriceEur * 0.3).toFixed(2));
    expectedSaleMaxEur = Number((basePriceEur * 0.6).toFixed(2));
  }

  // 1. Guard against anomalies and highly provisional unverified items
  if (isAnomaly || (isProvisional && typicalSaleSampleCount < 2 && confidenceScore < 30)) {
    return {
      decision: 'PROVISIONAL',
      badgeLabel: isAnomaly ? 'Flagged Anomaly' : 'Provisional Data',
      badgeColor: '#64748b',
      urgency: 'LOW',
      primaryReason: isAnomaly 
        ? 'Price exhibits extreme statistical deviation or anomaly; manual verification recommended.'
        : 'Insufficient price history for reliable decision; pricing remains provisional.',
      timingContext: 'Further price tracking required to establish reliable trend.',
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: cycleInfo.isSaleOverdue,
      upcomingEventName: upcomingEvent?.name,
      daysUntilUpcomingEvent: upcomingEvent?.daysUntil
    };
  }

  const isNearAtl = historicalLowEur !== undefined && (currentPriceEur <= historicalLowEur * 1.05);
  const isBetterThanMedian = typicalSaleMedianEur !== undefined && (currentPriceEur < typicalSaleMedianEur);

  // 2. STRONG BUY: Exceptional deal with reliable data
  if (dealScore >= 85 && confidenceScore >= 50) {
    const reason = isNearAtl
      ? `Exceptional buying opportunity: price matches or approaches all-time low (€${historicalLowEur?.toFixed(2)}).`
      : `Outstanding deal: price is significantly below the typical sale median of €${typicalSaleMedianEur?.toFixed(2)}.`;

    return {
      decision: 'STRONG_BUY',
      badgeLabel: 'Strong Buy',
      badgeColor: '#10b981',
      urgency: 'HIGH',
      primaryReason: reason,
      timingContext: 'Rarely discounted to this level; immediate purchase strongly recommended.',
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: false,
      upcomingEventName: upcomingEvent?.name,
      daysUntilUpcomingEvent: upcomingEvent?.daysUntil
    };
  }

  // 3. BUY: Great deal with solid confidence
  if (dealScore >= 70 && confidenceScore >= 35) {
    const savingVsMedian = typicalSaleMedianEur ? (typicalSaleMedianEur - currentPriceEur) : 0;
    const reason = savingVsMedian > 0
      ? `Great offer: €${savingVsMedian.toFixed(2)} cheaper than the customary sale price of €${typicalSaleMedianEur?.toFixed(2)}.`
      : 'Substantial discount compared to historical pricing.';

    return {
      decision: 'BUY',
      badgeLabel: 'Buy',
      badgeColor: '#06b6d4',
      urgency: 'MEDIUM',
      primaryReason: reason,
      timingContext: 'Solid discount relative to typical sale ranges.',
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: false,
      upcomingEventName: upcomingEvent?.name,
      daysUntilUpcomingEvent: upcomingEvent?.daysUntil
    };
  }

  // 4. WAIT: Imminent Major Steam Seasonal Sale & non-exceptional price
  if (upcomingEvent && upcomingEvent.isImminent && dealScore < 75) {
    return {
      decision: 'WAIT',
      badgeLabel: 'Wait (Steam Sale)',
      badgeColor: '#f59e0b',
      urgency: 'LOW',
      primaryReason: `Upcoming ${upcomingEvent.name} in ${upcomingEvent.daysUntil} day(s), where deeper discounts are expected.`,
      timingContext: `Recommended to wait for ${upcomingEvent.name} before purchasing.`,
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: cycleInfo.isSaleOverdue,
      upcomingEventName: upcomingEvent.name,
      daysUntilUpcomingEvent: upcomingEvent.daysUntil
    };
  }

  // 5. WAIT: Frequent regular sales & currently at normal/shallow price
  if (
    cycleInfo.avgDaysBetweenSales && 
    cycleInfo.avgDaysBetweenSales <= 45 && 
    dealScore < 60 &&
    typicalSaleMedianEur &&
    currentPriceEur >= typicalSaleMedianEur * 0.95
  ) {
    const timingDesc = cycleInfo.isSaleOverdue
      ? `Game discounts every ~${cycleInfo.avgDaysBetweenSales} days (${cycleInfo.daysSinceLastSale} days since last discount) — new sale expected soon.`
      : `Game discounts frequently (~every ${cycleInfo.avgDaysBetweenSales} days); target sale price is ~€${expectedSaleTargetEur?.toFixed(2)}.`;

    return {
      decision: 'WAIT',
      badgeLabel: 'Wait for Sale',
      badgeColor: '#f59e0b',
      urgency: 'LOW',
      primaryReason: `Regularly discounted title. Not optimal to buy now; frequently on sale around €${expectedSaleTargetEur?.toFixed(2)}.`,
      timingContext: timingDesc,
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: cycleInfo.isSaleOverdue,
      upcomingEventName: upcomingEvent?.name,
      daysUntilUpcomingEvent: upcomingEvent?.daysUntil
    };
  }

  // 6. FAIR: Decent discount, but routine
  if (dealScore >= 50) {
    return {
      decision: 'FAIR',
      badgeLabel: 'Fair Price',
      badgeColor: '#3b82f6',
      urgency: 'LOW',
      primaryReason: 'Standard discount price, but not an exceptional drop.',
      timingContext: expectedSaleTargetEur 
        ? `Game has previously reached a target price of €${expectedSaleTargetEur.toFixed(2)}.` 
        : 'Acceptable price level, but no rush to buy.',
      expectedSaleTargetEur,
      expectedSaleMinEur,
      expectedSaleMaxEur,
      avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
      daysSinceLastSale: cycleInfo.daysSinceLastSale,
      isSaleOverdue: cycleInfo.isSaleOverdue,
      upcomingEventName: upcomingEvent?.name,
      daysUntilUpcomingEvent: upcomingEvent?.daysUntil
    };
  }

  // 7. HOLD: Base price or very weak discount
  return {
    decision: 'HOLD',
    badgeLabel: 'Hold / Base Price',
    badgeColor: '#64748b',
    urgency: 'LOW',
    primaryReason: 'Game is currently at full base price or minimal discount.',
    timingContext: expectedSaleTargetEur 
      ? `Hold for the next sale; expected target price is ~€${expectedSaleTargetEur.toFixed(2)}.` 
      : 'Wait for an official discount before purchasing.',
    expectedSaleTargetEur,
    expectedSaleMinEur,
    expectedSaleMaxEur,
    avgDaysBetweenSales: cycleInfo.avgDaysBetweenSales,
    daysSinceLastSale: cycleInfo.daysSinceLastSale,
    isSaleOverdue: cycleInfo.isSaleOverdue,
    upcomingEventName: upcomingEvent?.name,
    daysUntilUpcomingEvent: upcomingEvent?.daysUntil
  };
}
