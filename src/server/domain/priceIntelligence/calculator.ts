import type { 
  PriceIntelligenceResponse, 
  Offer
} from '../../../shared/types.js';
import type { PriceIntelligenceInput } from './types.js';
import { calculatePeriodLows } from './periodLows.js';
import { calculateTypicalSalePrice } from './typicalSale.js';
import { groupSaleEvents } from './saleEvents.js';
import { calculatePriceVolatility } from './volatility.js';
import { calculateMarketComparison } from './marketComparison.js';
import { buildPriceChartData } from './chartData.js';
import { evaluatePurchaseAdvice } from './purchaseAdvice.js';
import { calculateDealScore } from '../dealScore/index.js';
import { generateActionSignal } from '../actionSignal/index.js';

/**
 * Top-level Pricing Intelligence Orchestrator & Legacy generator.
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

  const isSingleSourceLow = Boolean(periodLows.low1y.isSingleSourceLow ?? periodLows.low90d.isSingleSourceLow ?? periodLows.low30d.isSingleSourceLow ?? periodLows.low7d.isSingleSourceLow);

  const freshDealCalc = calculateDealScore({
    priceEur: currentPrice,
    basePriceEur: game.basePriceEur,
    typicalSaleMedianEur: typicalSale.medianPriceEur,
    typicalSaleQ1Eur: typicalSale.q1PriceEur,
    typicalSaleQ3Eur: typicalSale.q3PriceEur,
    low90dEur: periodLows.low90d.priceEur,
    low1yEur: periodLows.low1y.priceEur,
    allTimeLowEur: periodLows.allTimeLow.priceEur || game.historicalLowEur,
    historicalLowEur: periodLows.allTimeLow.priceEur || game.historicalLowEur,
    isConfirmedAtl: periodLows.allTimeLow.isConfirmed,
    isSingleSourceLow,
    sampleCount: history.length > 0 ? history.length : ((game as any).typical_sale_sample_count ?? (game as any).typicalSaleSampleCount),
    firstObservedAt: (game as any).priceTrackingFirstObservedAt || (game as any).price_tracking_first_observed_at || (history.length > 0 ? history[history.length - 1].recordedAt : undefined),
    lastObservedAt: bestOffer?.lastObservedAt || (history.length > 0 ? history[0].recordedAt : undefined),
    sourceCount: bestOffer?.sources?.length ?? (game as any).bestOfferSourceCount ?? (game as any).best_offer_source_count ?? 1,
    isAnomaly: Boolean(bestOffer?.isAnomaly),
    riskLevel: bestOffer?.riskLevel || 'SAFE'
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

export const calculatePriceIntelligence = generatePriceIntelligence;
