import React from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, Sparkles, ShieldAlert, Clock } from 'lucide-react';

interface GameCardProps {
  game: Game;
  onClick: () => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onClick }) => {
  const imageUrl = game.capsuleImage || 
    game.headerImage || 
    `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`;

  const hasBestDeal = game.bestPriceEur !== undefined;
  const isFree = game.isFree || game.bestPriceEur === 0;
  
  // Deal Score and Tier
  const dealScore = game.bestDealScore ?? 0;
  const dealTier = game.bestDealTier || 'Fair';

  const tierColor = 
    dealTier === 'Exceptional' ? '#8b5cf6' : 
    dealTier === 'Great' ? '#10b981' : 
    dealTier === 'Fair' ? '#3b82f6' : '#64748b';

  // 2D Event indicators
  const isConfirmedATL = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW';
  const isMajorDrop = game.bestPriceEvent === 'MAJOR_DROP' || game.bestPriceEvent === 'EXTREME_DROP';
  const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;
  const isMediumRisk = game.bestRiskLevel === 'MEDIUM';

  return (
    <div className="game-card" onClick={onClick}>
      <div className="game-card-image-wrap">
        <img 
          src={imageUrl} 
          alt={game.title} 
          className="game-card-image"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
          }}
        />

        {/* Top-Left: Discount Badge */}
        {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
          <div className="discount-badge">
            -{game.bestDiscountPercent}%
          </div>
        )}

        {/* Top-Right: Deal Score Badge (0-100) */}
        {hasBestDeal && dealScore > 0 && !isHighRisk && (
          <div 
            className="deal-score-badge"
            style={{ background: tierColor }}
            title={`Deal Score: ${dealScore}/100 • ${dealTier}`}
          >
            <span className="deal-score-num">{dealScore}</span>
            <span className="deal-score-tier-label">{dealTier}</span>
          </div>
        )}

        {/* High Risk Anomaly Warning */}
        {isHighRisk && (
          <div className="anomaly-tag" title="High risk pricing anomaly suppressed">
            <AlertTriangle size={12} />
            <span>High Risk</span>
          </div>
        )}

        {/* Price Event Pills */}
        {!isHighRisk && isConfirmedATL && (
          <div className="price-event-pill atl-pill">
            <Flame size={11} />
            <span>ATL</span>
          </div>
        )}

        {!isHighRisk && !isConfirmedATL && isMajorDrop && (
          <div className="price-event-pill major-pill">
            <Sparkles size={11} />
            <span>Major Drop</span>
          </div>
        )}
      </div>

      <div className="game-card-body">
        <div>
          <h3 className="game-title" title={game.title}>
            {game.title}
          </h3>
          
          {/* Historical Low Indicator */}
          {game.historicalLowEur !== undefined && (
            <div className="hist-low-indicator" style={{ marginTop: 4 }}>
              {isConfirmedATL ? (
                <>
                  <Flame size={12} color="#f59e0b" />
                  <span>ALL-TIME LOW</span>
                </>
              ) : (
                <span>Hist. Low: €{game.historicalLowEur.toFixed(2)}</span>
              )}
            </div>
          )}
        </div>

        {/* Risk warning chip if medium risk */}
        {isMediumRisk && !isHighRisk && (
          <div className="risk-warning-chip">
            <ShieldAlert size={12} color="#f59e0b" />
            <span>Caution: Unverified merchant</span>
          </div>
        )}

        <div className="game-meta-row">
          <div className="price-block">
            {game.basePriceEur && game.bestPriceEur && game.basePriceEur > game.bestPriceEur && (
              <span className="original-price">
                €{game.basePriceEur.toFixed(2)}
              </span>
            )}
            <span className={`best-price ${(game.bestDiscountPercent || 0) > 0 ? 'on-sale' : ''}`}>
              {isFree ? 'FREE' : hasBestDeal ? `€${game.bestPriceEur!.toFixed(2)}` : '—'}
            </span>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span className="merchant-tag">
              {game.bestMerchantName || 'Steam'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
