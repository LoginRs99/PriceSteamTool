import type { Offer, MarketComparison } from '../../../shared/types.js';

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
    const isTrusted = Boolean(currentBestOffer && !currentBestOffer.isAnomaly && currentBestOffer.riskLevel !== 'HIGH');
    return {
      marketMedianEur: p,
      minOfficialPriceEur: currentBestOffer?.isOfficial ? p : undefined,
      minTrustedPriceEur: isTrusted ? p : undefined,
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

  const minTrusted = Math.min(...compatible.map(o => o.priceEur));

  let currentRank = 1;
  const currentPrice = currentBestOffer?.priceEur || 0;
  if (currentPrice > 0) {
    currentRank = prices.filter(p => p < currentPrice).length + 1;
  }

  const pctBelowMedian = (median > 0 && currentPrice > 0 && currentPrice < median)
    ? Math.round(((median - currentPrice) / median) * 100)
    : 0;

  return {
    marketMedianEur: Number(median.toFixed(2)),
    minOfficialPriceEur: minOfficial ? Number(minOfficial.toFixed(2)) : undefined,
    minTrustedPriceEur: Number(minTrusted.toFixed(2)),
    totalCompatibleOffers: compatible.length,
    currentRank,
    percentBelowMarketMedian: pctBelowMedian
  };
}
