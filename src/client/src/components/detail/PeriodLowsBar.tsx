import React from 'react';
import type { PriceIntelligenceResponse } from '../../types.js';
import { Flame } from 'lucide-react';

interface PeriodLowsBarProps {
  periodLows?: PriceIntelligenceResponse['periodLows'];
}

export const PeriodLowsBar: React.FC<PeriodLowsBarProps> = ({ periodLows }) => {
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
            {periodLows.low7d.priceEur !== null ? `€${periodLows.low7d.priceEur.toFixed(2)}` : '—'}
          </div>
          <span className="period-meta">
            {periodLows.low7d.merchantName || (periodLows.low7d.isExactPeriodData ? 'No price drops' : 'No 7d coverage')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">30-Day Low</span>
          <div className="period-value ticker-num">
            {periodLows.low30d.priceEur !== null ? `€${periodLows.low30d.priceEur.toFixed(2)}` : '—'}
          </div>
          <span className="period-meta">
            {periodLows.low30d.merchantName || (periodLows.low30d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">90-Day Low</span>
          <div className="period-value ticker-num">
            {periodLows.low90d.priceEur !== null ? `€${periodLows.low90d.priceEur.toFixed(2)}` : '—'}
          </div>
          <span className="period-meta">
            {periodLows.low90d.merchantName || (periodLows.low90d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card">
          <span className="period-label">1-Year Low</span>
          <div className="period-value ticker-num">
            {periodLows.low1y.priceEur !== null ? `€${periodLows.low1y.priceEur.toFixed(2)}` : '—'}
          </div>
          <span className="period-meta">
            {periodLows.low1y.merchantName || (periodLows.low1y.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
          </span>
        </div>

        <div className="period-card atl-card" style={{ borderColor: 'rgba(251, 191, 36, 0.35)', background: 'var(--signal-dim)' }}>
          <span className="period-label" style={{ color: 'var(--signal)' }}>All-Time Low</span>
          <div className="period-value ticker-num" style={{ color: 'var(--signal)' }}>
            €{periodLows.allTimeLow.priceEur.toFixed(2)}
          </div>
          <span className="period-meta">
            {periodLows.allTimeLow.isConfirmed ? `Confirmed (${periodLows.allTimeLow.source || 'ITAD/Steam'})` : 'Observed low'}
          </span>
        </div>
      </div>
    </div>
  );
};
