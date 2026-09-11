import type { 
  Game, 
  Offer, 
  PriceIntelligenceResponse, 
  TypicalSalePrice, 
  PurchaseAdvice,
  ActionSignal
} from '../../../shared/types.js';

/**
 * Buy / Fair / Wait Decision Engine with Precedence & Safety Guard
 */
export function evaluatePurchaseAdvice(
  game: Game,
  currentBestOffer: Offer | undefined,
  periodLows: PriceIntelligenceResponse['periodLows'],
  typicalSale: TypicalSalePrice,
  actionSignal?: ActionSignal
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
      confidence: actionSignal?.decision === 'PROVISIONAL' ? 'LOW' : 'HIGH',
      headline: 'High Risk Price Anomaly',
      reasoning: [
        'Current offer is flagged as an unverified pricing error or high-risk seller.',
        currentBestOffer.anomalyReason || 'Price is an extreme outlier.'
      ]
    };
  }

  // 3. Flags for reasoning explanation builders
  const isAtOrBelowATL = atl !== null && atl > 0 && currentPrice <= (atl + 0.05);
  const isDeepTypicalSale = typicalSale.medianPriceEur !== null && currentPrice <= (typicalSale.medianPriceEur * 0.85);
  const isHighDealScore = dealScore >= 80;

  const isWithinTypicalBand = typicalSale.medianPriceEur !== null && 
    currentPrice <= (typicalSale.medianPriceEur * 1.10) && 
    currentPrice >= (typicalSale.medianPriceEur * 0.85);

  const isDecentSale = discount >= 30 && dealScore >= 50;
  const isNear90dLow = periodLows.low90d.priceEur !== null && 
    currentPrice <= (periodLows.low90d.priceEur * 1.05) &&
    discount >= 25 &&
    (typicalSale.medianPriceEur === null || currentPrice <= typicalSale.medianPriceEur * 1.15);

  let decision: 'BUY' | 'FAIR' | 'WAIT';
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  if (actionSignal) {
    if (actionSignal.decision === 'STRONG_BUY' || actionSignal.decision === 'BUY') {
      decision = 'BUY';
      confidence = 'HIGH';
    } else if (actionSignal.decision === 'FAIR') {
      decision = 'FAIR';
      confidence = 'MEDIUM';
    } else {
      // WAIT | HOLD | PROVISIONAL
      decision = 'WAIT';
      confidence = actionSignal.decision === 'PROVISIONAL' ? 'LOW' : 'MEDIUM';
    }
  } else {
    // Fallback when actionSignal is not supplied
    if (isAtOrBelowATL || isDeepTypicalSale || isHighDealScore) {
      decision = 'BUY';
      confidence = 'HIGH';
    } else if (isWithinTypicalBand || isDecentSale || isNear90dLow) {
      decision = 'FAIR';
      confidence = 'MEDIUM';
    } else {
      decision = 'WAIT';
      confidence = 'MEDIUM';
    }
  }

  if (decision === 'BUY') {
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
      confidence,
      headline: 'Exceptional Buying Opportunity',
      reasoning: reasons.length > 0 ? reasons : ['Outstanding price relative to historical anchors.']
    };
  }

  if (decision === 'FAIR') {
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
      confidence,
      headline: 'Fair Sale Price',
      reasoning: reasons.length > 0 ? reasons : ['Fair market price for this title.']
    };
  }

  // decision === 'WAIT'
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
    confidence,
    headline: 'Wait for Better Discount',
    reasoning: waitReasons.length > 0 ? waitReasons : ['Wait for deeper seasonal discount.']
  };
}
