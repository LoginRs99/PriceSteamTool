import React from 'react';
import type { Game } from '../types.js';
import { Flame } from 'lucide-react';

interface TickerFlagProps {
  game: Game;
  className?: string;
  style?: React.CSSProperties;
}

const TickerFlagComponent: React.FC<TickerFlagProps> = ({ game, className = '', style }) => {
  const hasBestDeal = game.bestPriceEur !== undefined;
  const isConfirmedATL = (game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW') && !game.bestIsProvisional;
  const isTargetHit = game.targetPriceEur !== undefined && hasBestDeal && game.bestPriceEur! <= game.targetPriceEur;
  const isTargetPending = game.targetPriceEur !== undefined && (!hasBestDeal || game.bestPriceEur! > game.targetPriceEur);
  const discount = game.bestDiscountPercent ?? 0;

  const isPricingError = game.bestPriceEvent === 'PRICING_ERROR' || (
    (game.bestRiskLevel === 'HIGH' || game.hasAnomaly) && (game.bestDiscountPercent ?? 0) >= 75
  );

  // Priority 0: Glitch Hunter / Pricing Error (Highest Urgency)
  if (isPricingError) {
    return (
      <span 
        className={`ticker-flag ${className}`} 
        style={{ 
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', 
          color: '#fff', 
          border: '1px solid #f87171',
          fontWeight: 800,
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)',
          ...style 
        }} 
        title="⚡ Pricing Error / Glitch Deal — Immediate purchase recommended before correction!"
      >
        <span>⚡ GLITCH</span>
      </span>
    );
  }

  // Priority 1: All-Time-Low
  if (isConfirmedATL) {
    return (
      <span className={`ticker-flag ticker-flag-atl ${className}`} style={style} title="Confirmed All-Time Low price">
        <Flame size={11} />
        <span>ATL</span>
      </span>
    );
  }

  // Priority 2: Target Price Hit
  if (isTargetHit) {
    return (
      <span
        className={`ticker-flag ticker-flag-down ${className}`}
        style={style}
        title={`Target price (€${game.targetPriceEur!.toFixed(2)}) reached!`}
      >
        <span>🎯 HIT</span>
      </span>
    );
  }

  // Priority 3: Target Pending
  if (isTargetPending) {
    return (
      <span
        className={`ticker-flag ticker-flag-dim ${className}`}
        style={style}
        title={`Target alert set at €${game.targetPriceEur!.toFixed(2)}`}
      >
        <span>🎯 €{game.targetPriceEur!.toFixed(2)}</span>
      </span>
    );
  }

  // Priority 4: Discount Percentage
  if (discount > 0) {
    return (
      <span className={`ticker-flag ticker-flag-down ${className}`} style={style}>
        -{discount}%
      </span>
    );
  }

  return null;
};

export const TickerFlag = React.memo(TickerFlagComponent);

