import React from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, Sparkles } from 'lucide-react';

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
  
  // 2D Event indicators
  const isHistoricalLow = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || 
    (hasBestDeal && game.historicalLowEur !== undefined && game.bestPriceEur !== undefined && game.bestPriceEur <= (game.historicalLowEur + 0.05));
  const isMajorDrop = game.bestPriceEvent === 'MAJOR_DROP' || game.bestPriceEvent === 'EXTREME_DROP';
  const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;

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

        {/* Discount Badge */}
        {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
          <div className="discount-badge">
            -{game.bestDiscountPercent}%
          </div>
        )}

        {/* High Risk Anomaly Badge */}
        {isHighRisk && (
          <div className="anomaly-tag" title="Possible price glitch or extreme unverified outlier">
            <AlertTriangle size={12} />
            <span>High Risk</span>
          </div>
        )}

        {/* Verified Event Badge */}
        {!isHighRisk && isMajorDrop && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(139, 92, 246, 0.9)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 800,
            padding: '3px 8px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            textTransform: 'uppercase',
            letterSpacing: 0.4
          }}>
            <Sparkles size={11} />
            <span>Mega Deal</span>
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
            <div className="hist-low-indicator" style={{ marginTop: 6 }}>
              {isHistoricalLow ? (
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
