import React from 'react';
import type { PriceIntelligenceResponse } from '../../types.js';
import { Flame, ShieldCheck } from 'lucide-react';
import { useCurrency } from '../../context/CurrencyContext.js';

interface PeriodLowsBarProps {
  periodLows?: PriceIntelligenceResponse['periodLows'];
  officialLowEur?: number;
  officialLowSource?: string;
}

export const PeriodLowsBar: React.FC<PeriodLowsBarProps> = ({ periodLows, officialLowEur, officialLowSource }) => {
  const { formatPrice } = useCurrency();
  if (!periodLows) return null;

  return (
    <div>
      <h4 className="section-subtitle">
        <Flame size={15} color="var(--signal)" />
        <span>Rolling Period Lows & Confirmed ATL</span>
      </h4>

      <div className="period-lows-grid">
        <div className="period-card">
          <span className="period-label">7-Day Low</span>
          <div className="period-value ticker-num">
            {formatPrice(periodLows.low7d.priceEur)}
          </div>
          <span className="period-meta">
            {periodLows.low7d.merchantName || (periodLows.low7d.isExactPeriodData ? 'No price drops' : 'No 7d coverage')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">30-Day Low</span>
          <div className="period-value ticker-num">
            {formatPrice(periodLows.low30d.priceEur)}
          </div>
          <span className="period-meta">
            {periodLows.low30d.merchantName || (periodLows.low30d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">90-Day Low</span>
          <div className="period-value ticker-num">
            {formatPrice(periodLows.low90d.priceEur)}
          </div>
          <span className="period-meta">
            {periodLows.low90d.merchantName || (periodLows.low90d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">1-Year Low</span>
          <div className="period-value ticker-num">
            {formatPrice(periodLows.low1y.priceEur)}
          </div>
          <span className="period-meta">
            {periodLows.low1y.merchantName || (periodLows.low1y.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card atl-card" style={{ borderColor: 'rgba(251, 191, 36, 0.35)', background: 'var(--signal-dim)' }}>
          <span className="period-label" style={{ color: 'var(--signal)' }}>All-Store ATL</span>
          <div className="period-value ticker-num" style={{ color: 'var(--signal)' }}>
            {formatPrice(periodLows.allTimeLow.priceEur)}
          </div>
          <span className="period-meta">
            {periodLows.allTimeLow.isConfirmed ? `Confirmed (${periodLows.allTimeLow.source || 'ITAD/Steam'})` : 'Observed low'}
          </span>
        </div>

        {officialLowEur !== undefined && officialLowEur > 0 && (
          <div className="period-card" style={{ borderColor: 'rgba(16, 185, 129, 0.35)', background: 'rgba(16, 185, 129, 0.08)' }}>
            <span className="period-label" style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 3 }}>
              <ShieldCheck size={12} /> Official ATL
            </span>
            <div className="period-value ticker-num" style={{ color: '#10b981' }}>
              {formatPrice(officialLowEur)}
            </div>
            <span className="period-meta">
              {officialLowSource ? `Verified (${officialLowSource})` : 'Official Retailers'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
