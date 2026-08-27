import type { 
  Game, 
  Offer, 
  PriceIntelligenceResponse, 
  TypicalSalePrice, 
  PurchaseAdvice 
} from '../../../shared/types.js';

/**
 * Buy / Fair / Wait Decision Engine with Precedence & Safety Guard
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
  const hasNoConfirmedDrop = !periodLows.allTimeLow.isConfirmed || periodLows.allTimeLow.priceEur === null || periodLows.allTimeLow.priceEur >= currentPrice;

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
  const isAtOrBelowATL = atl !== null && atl > 0 && currentPrice <= (atl + 0.05);
  const isDeepTypicalSale = typicalSale.medianPriceEur !== null && currentPrice <= (typicalSale.medianPriceEur * 0.85);
  const isHighDealScore = dealScore >= 80;

  if (isAtOrBelowATL || isDeepTypicalSale || isHighDealScore) {
    const reasons: string[] = [];
    if (isAtOrBelowATL && atl !== null) {
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
