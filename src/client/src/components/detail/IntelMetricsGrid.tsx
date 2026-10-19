import React from 'react';
import type { PriceIntelligenceResponse } from '../../types.js';
import { TrendingDown, Calendar, Activity, Scale } from 'lucide-react';
import { useCurrency } from '../../context/CurrencyContext.js';

interface IntelMetricsGridProps {
  intelligence?: PriceIntelligenceResponse;
}

export const IntelMetricsGrid: React.FC<IntelMetricsGridProps> = ({ intelligence }) => {
  const { formatPrice } = useCurrency();
  const typicalSale = intelligence?.typicalSale;
  const frequency = intelligence?.frequency;
  const volatility = intelligence?.volatility;
  const marketComp = intelligence?.marketComparison;

  return (
    <div className="intel-metrics-grid">
      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Typical Sale Price</span>
          <TrendingDown size={15} color="var(--accent-blue)" />
        </div>
        <div className="intel-value ticker-num" style={{ color: 'var(--accent-blue)' }}>
          {typicalSale?.medianPriceEur != null ? formatPrice(typicalSale.medianPriceEur) : '—'}
        </div>
        <span className="intel-sub">
          {typicalSale?.medianPriceEur != null
            ? (typicalSale.q1PriceEur != null && typicalSale.q3PriceEur != null && (typicalSale.sampleCount ?? 0) >= 3
                ? `Typical band: ${formatPrice(typicalSale.q1PriceEur)} – ${formatPrice(typicalSale.q3PriceEur)} (${typicalSale.sampleCount} sales)`
                : `Based on ${typicalSale.sampleCount} recorded sale${typicalSale.sampleCount === 1 ? '' : 's'}`)
            : 'Insufficient historical sales'}
        </span>
      </div>

      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Sale Frequency</span>
          <Calendar size={15} color="var(--accent-purple)" />
        </div>
        <div className="intel-value" style={{ color: 'var(--accent-purple)' }}>
          {frequency?.frequencyCategory || 'Rare'}
        </div>
        <span className="intel-sub">
          {frequency && frequency.saleEventsLast12m > 0
            ? `${frequency.saleEventsLast12m} sales in last 12 mo (${frequency.avgDaysBetweenSales ? `~${frequency.avgDaysBetweenSales}d apart` : 'single period'})`
            : 'No sales recorded in 12 mo'}
        </span>
      </div>

      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Price Volatility</span>
          <Activity size={15} color="var(--dim)" />
        </div>
        <div className="intel-value" style={{ color: 'var(--ink)' }}>
          {volatility?.category || 'Stable'}
        </div>
        <span className="intel-sub">
          {volatility
            ? `${volatility.priceChangesCount} price shift${volatility.priceChangesCount === 1 ? '' : 's'} recorded (fluctuation index: ${volatility.rawCv})`
            : 'Stable pricing'}
        </span>
      </div>

      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Price vs Market</span>
          <Scale size={15} color="var(--down)" />
        </div>
        <div className="intel-value ticker-num" style={{ color: 'var(--down)' }}>
          {marketComp && marketComp.totalCompatibleOffers > 0
            ? `#${marketComp.currentRank} of ${marketComp.totalCompatibleOffers}`
            : '#1 of 1'}
        </div>
        <span className="intel-sub">
          {marketComp && marketComp.percentBelowMarketMedian > 0
            ? `${marketComp.percentBelowMarketMedian}% below market median (${formatPrice(marketComp.marketMedianEur)})`
            : 'At current market median'}
        </span>
      </div>
    </div>
  );
};
