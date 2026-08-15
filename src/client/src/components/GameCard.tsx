import React from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, ExternalLink } from 'lucide-react';

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
  const isHistoricalLow = hasBestDeal && 
    game.historicalLowEur !== undefined && 
    game.bestPriceEur !== undefined &&
    game.bestPriceEur <= (game.historicalLowEur + 0.05);

  return (
    <div className="game-card" onClick={onClick}>
      <div className="game-card-image-wrap">
        <img 
          src={imageUrl} 
          alt={game.title} 
          className="game-card-image"
          loading="lazy"
          onError={(e) => {
            // Fallback to Steam header image if capsule fails
            (e.target as HTMLImageElement).src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
          }}
        />

        {/* Discount Badge */}
        {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
          <div className="discount-badge">
            -{game.bestDiscountPercent}%
          </div>
        )}

        {/* Anomaly Badge */}
        {game.hasAnomaly && (
          <div className="anomaly-tag" title="Possible price anomaly detected">
            <AlertTriangle size={12} />
            <span>Anomaly</span>
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
                  <span>NEW HISTORICAL LOW</span>
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
