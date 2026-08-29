import React from 'react';
import type { Game, Offer, PriceIntelligenceResponse } from '../../types.js';
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
    advice.decision === 'BUY' ? '#10b981' : 
    advice.decision === 'FAIR' ? '#38bdf8' : '#f59e0b';

  const adviceBg = 
    advice.decision === 'BUY' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(21, 29, 46, 0.95) 100%)' :
    advice.decision === 'FAIR' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(21, 29, 46, 0.95) 100%)' :
    'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(21, 29, 46, 0.95) 100%)';

  return (
    <div style={{
      background: adviceBg,
      border: `1px solid ${adviceColor}44`,
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: 16
    }}>
      <div style={{ flex: '1 1 340px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span 
            className="advice-decision-badge"
            style={{ background: adviceColor, color: '#042f2e' }}
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

        <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f8fafc', margin: '6px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>€{bestOffer ? bestOffer.priceEur.toFixed(2) : (game.basePriceEur?.toFixed(2) ?? '—')}</span>
          {(bestOffer?.isFresh === false || (game.bestIsFresh === false && !bestOffer)) && (
            <span 
              className="stale-badge"
              style={{ 
                fontSize: '0.72rem', 
                fontWeight: 700, 
                padding: '2px 7px', 
                borderRadius: 4, 
                background: 'rgba(148, 163, 184, 0.18)', 
                color: 'var(--text-muted)', 
                border: '1px solid rgba(148, 163, 184, 0.3)',
                fontFamily: 'inherit'
              }}
              title="Stale fallback price (last observed >72h ago)"
            >
              Stale Price
            </span>
          )}
          {bestOffer && (bestOffer.discountPercent || 0) > 0 && (
            <span style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
              €{bestOffer.originalPriceEur?.toFixed(2)}
            </span>
          )}
          {bestOffer?.rawCurrency && bestOffer.rawCurrency !== 'EUR' && bestOffer.rawPrice && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
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

      {bestOffer && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
            Best offer sold by <strong>{bestOffer.merchantName}</strong>
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
  );
};
