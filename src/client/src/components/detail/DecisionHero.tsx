import React from 'react';
import type { Game, Offer, PriceIntelligenceResponse } from '../../types.js';
import { Sparkline } from '../Sparkline.js';
import { 
  Sparkles, 
  Scale, 
  Clock, 
  CheckCircle, 
  ExternalLink 
} from 'lucide-react';

interface DecisionHeroProps {
  game: Game;
  bestOffer?: Offer;
  intelligence?: PriceIntelligenceResponse;
}

export const DecisionHero: React.FC<DecisionHeroProps> = ({
  game,
  bestOffer,
  intelligence
}) => {
  const advice = intelligence?.advice || {
    decision: 'FAIR' as const,
    confidence: 'MEDIUM' as const,
    headline: 'Market Price Analysis',
    reasoning: ['Analysis based on current offers and available price history.']
  };

  const adviceColor = 
    advice.decision === 'BUY' ? 'var(--down)' : 
    advice.decision === 'FAIR' ? 'var(--accent-blue)' : 'var(--signal)';

  const adviceBg = 
    advice.decision === 'BUY' ? 'linear-gradient(135deg, var(--down-dim) 0%, var(--surface) 100%)' :
    advice.decision === 'FAIR' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, var(--surface) 100%)' :
    'linear-gradient(135deg, var(--signal-dim) 0%, var(--surface) 100%)';

  const chartPoints = intelligence?.chartData?.points && intelligence.chartData.points.length > 0
    ? intelligence.chartData.points.map(p => p.priceEur)
    : undefined;

  return (
    <div style={{
      background: adviceBg,
      border: `1px solid ${adviceColor}44`,
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 16
    }}>
      <div style={{ flex: '1 1 340px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span 
            className="advice-decision-badge"
            style={{ background: adviceColor, color: '#0a0b0e' }}
          >
            {advice.decision === 'BUY' && <Sparkles size={13} />}
            {advice.decision === 'FAIR' && <Scale size={13} />}
            {advice.decision === 'WAIT' && <Clock size={13} />}
            <span>{advice.decision}</span>
          </span>

          <span style={{ fontSize: 14, fontWeight: 700, color: adviceColor }}>
            {advice.headline}
          </span>
        </div>

        <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)', margin: '6px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span className="ticker-num">€{bestOffer ? bestOffer.priceEur.toFixed(2) : (game.basePriceEur?.toFixed(2) ?? '—')}</span>
          {(bestOffer?.isFresh === false || (game.bestIsFresh === false && !bestOffer)) && (
            <span 
              className="stale-badge"
              style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                padding: '2px 7px', 
                borderRadius: 'var(--radius-sm)', 
                background: 'rgba(148, 163, 184, 0.18)', 
                color: 'var(--dim)', 
                border: '1px solid var(--line)',
                fontFamily: 'inherit'
              }}
              title="Stale fallback price (last observed >72h ago)"
            >
              Stale Price
            </span>
          )}
          {bestOffer && (bestOffer.discountPercent || 0) > 0 && (
            <span className="ticker-num" style={{ fontSize: 14, color: 'var(--dim-2)', textDecoration: 'line-through' }}>
              €{bestOffer.originalPriceEur?.toFixed(2)}
            </span>
          )}
          {bestOffer?.rawCurrency && bestOffer.rawCurrency !== 'EUR' && bestOffer.rawPrice && (
            <span className="ticker-num" style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 400 }}>
              ({bestOffer.rawPrice.toFixed(2)} {bestOffer.rawCurrency})
            </span>
          )}
        </div>

        {/* Reasoning Bullet Points */}
        <ul className="advice-reasons-list">
          {advice.reasoning.map((r, idx) => (
            <li key={idx}>
              <CheckCircle size={12} color={adviceColor} style={{ flexShrink: 0, marginTop: 3 }} />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Prominent Decision Hero Sparkline & Best Offer CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, minWidth: 200 }}>
        <div style={{ background: 'rgba(10, 11, 14, 0.5)', padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 2 }}>
            Price Trajectory
          </div>
          <Sparkline points={chartPoints} game={game} width={200} height={36} />
        </div>

        {bestOffer && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--dim)', textAlign: 'right' }}>
              Best offer sold by <strong style={{ color: 'var(--ink)' }}>{bestOffer.merchantName}</strong>
            </div>
            <a
              href={bestOffer.dealUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ padding: '10px 22px', fontSize: 14 }}
            >
              <span>Go to Deal</span>
              <ExternalLink size={15} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
