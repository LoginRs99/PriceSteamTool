import React, { useState } from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, ShieldCheck, Info, Gamepad2 } from 'lucide-react';

interface GameCardProps {
  game: Game;
  onClick: () => void;
  onExplain?: (game: Game) => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onClick, onExplain }) => {
  const [imgError, setImgError] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  const imageUrl = game.capsuleImage || 
    game.headerImage || 
    `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`;

  const hasBestDeal = game.bestPriceEur !== undefined;
  const isFree = game.isFree || game.bestPriceEur === 0;
  
  // Deal Score
  const dealScore = game.bestDealScore ?? 0;
  const dealTier = game.bestDealTier || 'Fair';
  const isProvisional = Boolean(game.bestIsProvisional);

  const tierColor = 
    dealTier === 'Exceptional' ? '#8b5cf6' : 
    dealTier === 'Great' ? '#10b981' : 
    dealTier === 'Good' ? '#06b6d4' :
    dealTier === 'Fair' ? '#3b82f6' : '#64748b';

  // Primary event flags
  const isConfirmedATL = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW';
  const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;

  // Real context savings
  const savingVsMedian = game.bestSavingVsMedianEur;
  const typicalMedian = game.typicalSaleMedianEur;

  return (
    <div className="game-card" onClick={onClick}>
      {/* Cover Image Container */}
      <div className="game-card-image-wrap">
        {!imgError ? (
          <img 
            src={imageUrl} 
            alt={game.title} 
            className="game-card-image"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              if (!triedFallback) {
                setTriedFallback(true);
                target.src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
              } else {
                setImgError(true);
              }
            }}
          />
        ) : (
          <div 
            className="game-card-image" 
            style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              color: 'var(--text-muted)',
              gap: 6
            }}
          >
            <Gamepad2 size={24} style={{ opacity: 0.6 }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0 8px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>
              {game.title}
            </span>
          </div>
        )}

        {/* Top-Left Badges: Discount & ATL */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 6, zIndex: 3 }}>
          {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
            <div className="discount-badge" style={{ position: 'static' }}>
              -{game.bestDiscountPercent}%
            </div>
          )}

          {isConfirmedATL && !isProvisional && (
            <div className="price-event-pill atl-pill" style={{ position: 'static' }}>
              <Flame size={11} />
              <span>ATL</span>
            </div>
          )}
        </div>

        {/* Top-Right: Unified Deal Score & Store Pill */}
        {hasBestDeal && (
          <div 
            className="deal-score-badge"
            style={{ 
              background: dealScore > 0 ? tierColor : 'rgba(30, 41, 59, 0.88)', 
              zIndex: 3,
              cursor: onExplain && dealScore > 0 ? 'pointer' : 'default'
            }}
            title={`Deal Score: ${dealScore}/100 • ${dealTier}${game.bestMerchantName ? ` (${game.bestMerchantName})` : ''}`}
            onClick={(e) => {
              if (onExplain && dealScore > 0) {
                e.stopPropagation();
                onExplain(game);
              }
            }}
          >
            {dealScore > 0 ? (
              <>
                <span className="deal-score-num">{dealScore}</span>
                <span className="deal-score-tier-label">{dealTier}</span>
              </>
            ) : (
              <span className="deal-score-tier-label" style={{ padding: '0 4px' }}>
                {game.bestMerchantName || 'Best Deal'}
              </span>
            )}
          </div>
        )}

        {/* Bottom-Left: Action Signal Pill (Must Buy, Buy, Wait, etc.) */}
        {game.actionSignal && !isHighRisk && (
          <div 
            className="action-signal-pill" 
            style={{ 
              position: 'absolute', 
              bottom: 8, 
              left: 8, 
              background: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${game.actionSignal.badgeColor}88`,
              color: game.actionSignal.badgeColor,
              padding: '4px 9px',
              borderRadius: 6,
              fontSize: '0.74rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              zIndex: 3,
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)'
            }}
            title={`${game.actionSignal.badgeLabel}: ${game.actionSignal.primaryReason}`}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: game.actionSignal.badgeColor, boxShadow: `0 0 6px ${game.actionSignal.badgeColor}` }} />
            <span>{game.actionSignal.badgeLabel}</span>
          </div>
        )}

        {/* Target Price Indicator */}
        {game.targetPriceEur !== undefined && (
          <div
            className="target-price-indicator-badge"
            style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              background: 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38bdf8',
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: '0.68rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              zIndex: 2
            }}
            title={`Target Price Alert set at €${game.targetPriceEur.toFixed(2)}`}
          >
            <span>🎯</span>
            <span>€{game.targetPriceEur.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Card Content */}
      <div className="game-card-body">
        <div>
          <h3 className="game-title" title={game.title}>
            {game.title}
          </h3>

          {/* Context Line: Explain savings vs typical sale or historical low */}
          <div className="hist-context-line" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 3 }}>
            {savingVsMedian && savingVsMedian > 0 && typicalMedian ? (
              <span style={{ color: '#10b981', fontWeight: 600 }}>
                €{savingVsMedian.toFixed(2)} below typical (€{typicalMedian.toFixed(2)})
              </span>
            ) : isConfirmedATL ? (
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                ★ Matches All-Time Low
              </span>
            ) : game.historicalLowEur !== undefined ? (
              <span>Hist. Low: €{game.historicalLowEur.toFixed(2)}</span>
            ) : (
              <span>Standard catalog price</span>
            )}
          </div>
        </div>

        {/* Primary Price & Merchant Row */}
        <div className="game-meta-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isHighRisk && (
              <span 
                className="merchant-tag" 
                style={{ 
                  background: 'rgba(245, 158, 11, 0.12)', 
                  borderColor: 'rgba(245, 158, 11, 0.35)', 
                  color: '#f59e0b', 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 3, 
                  padding: '2px 6px', 
                  fontSize: '0.7rem',
                  fontWeight: 700
                }}
                title="Price is an unconfirmed drop or anomaly"
              >
                <AlertTriangle size={11} />
                <span>Risk Flag</span>
              </span>
            )}

            <span className="merchant-tag" title={`Store: ${game.bestMerchantName || 'Steam Store'}`}>
              {game.bestMerchantIsOfficial && <ShieldCheck size={11} color="#10b981" style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />}
              {game.bestMerchantName || 'Steam'}
            </span>

            {onExplain && (
              <button 
                type="button" 
                className="score-info-trigger"
                title="Explain why this score was assigned"
                onClick={(e) => {
                  e.stopPropagation();
                  onExplain(game);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <Info size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
