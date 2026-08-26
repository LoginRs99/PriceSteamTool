import React from 'react';
import type { PriceIntelligenceResponse } from '../../types.js';
import { TrendingDown, Calendar, Activity, Scale } from 'lucide-react';

interface IntelMetricsGridProps {
  intelligence?: PriceIntelligenceResponse;
}

export const IntelMetricsGrid: React.FC<IntelMetricsGridProps> = ({ intelligence }) => {
  const typicalSale = intelligence?.typicalSale;
  const frequency = intelligence?.frequency;
  const volatility = intelligence?.volatility;
  const marketComp = intelligence?.marketComparison;

  return (
    <div className="intel-metrics-grid">
      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Typical Sale Price</span>
          <TrendingDown size={15} color="#38bdf8" />
        </div>
        <div className="intel-value" style={{ color: '#38bdf8' }}>
          {typicalSale?.medianPriceEur !== null ? `€${typicalSale?.medianPriceEur?.toFixed(2)}` : '—'}
        </div>
        <span className="intel-sub">
          {typicalSale && typicalSale.medianPriceEur !== null
            ? `IQR Range: €${typicalSale.q1PriceEur?.toFixed(2)} – €${typicalSale.q3PriceEur?.toFixed(2)} (${typicalSale.sampleCount} sales)`
            : 'Insufficient historical sales'}
        </span>
      </div>

      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Sale Frequency</span>
          <Calendar size={15} color="#8b5cf6" />
        </div>
        <div className="intel-value" style={{ color: '#a78bfa' }}>
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
          <Activity size={15} color="#f59e0b" />
        </div>
        <div className="intel-value" style={{ color: '#f59e0b' }}>
          {volatility?.category || 'Stable'}
        </div>
        <span className="intel-sub">
          {volatility
            ? `${volatility.priceChangesCount} price shifts on observed days (CV: ${volatility.rawCv})`
            : 'Stable pricing'}
        </span>
      </div>

      <div className="intel-card">
        <div className="intel-card-header">
          <span className="intel-label">Price vs Market</span>
          <Scale size={15} color="#10b981" />
        </div>
        <div className="intel-value" style={{ color: '#10b981' }}>
          {marketComp && marketComp.totalCompatibleOffers > 0
            ? `#${marketComp.currentRank} of ${marketComp.totalCompatibleOffers}`
            : '#1 of 1'}
        </div>
        <span className="intel-sub">
          {marketComp && marketComp.percentBelowMarketMedian > 0
            ? `${marketComp.percentBelowMarketMedian}% below market median (€${marketComp.marketMedianEur.toFixed(2)})`
            : 'At current market median'}
        </span>
      </div>
    </div>
  );
};
