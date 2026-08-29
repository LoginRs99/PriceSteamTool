import React from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react';

interface CompactListViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
}

export const CompactListView: React.FC<CompactListViewProps> = ({ games, onGameClick, onExplain }) => {
  return (
    <div className="compact-list-container">
      {games.map(game => {
        const hasBestDeal = game.bestPriceEur !== undefined;
        const isFree = game.isFree || game.bestPriceEur === 0;
        const dealScore = game.bestDealScore ?? 0;
        const dealTier = game.bestDealTier || 'Fair';
        const isProvisional = Boolean(game.bestIsProvisional);

        const tierColor = 
          dealTier === 'Exceptional' ? '#8b5cf6' : 
          dealTier === 'Great' ? '#10b981' : 
          dealTier === 'Good' ? '#06b6d4' :
          dealTier === 'Fair' ? '#3b82f6' : '#64748b';

        const isConfirmedATL = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW';
        const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;

        const imageUrl = game.capsuleImage || 
          game.headerImage || 
          `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`;

        return (
          <div 
            key={game.id} 
            className="compact-row"
            onClick={() => onGameClick(game)}
          >
            {/* Priority & Thumb */}
            <div className="compact-left">
              {game.priority !== undefined && (
                <span className="compact-priority">#{game.priority}</span>
              )}
              <img 
                src={imageUrl} 
                alt={game.title} 
                className="compact-thumb"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.dataset.triedFallback) {
                    target.dataset.triedFallback = 'true';
                    target.src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
                  } else {
                    target.style.display = 'none';
                  }
                }}
              />
              <div className="compact-title-wrap">
                <span className="compact-title" title={game.title}>{game.title}</span>
                <div className="compact-tags">
                  {game.actionSignal && !isHighRisk && (
                    <span 
                      className="tag-pill"
                      style={{ 
                        background: `${game.actionSignal.badgeColor}22`, 
                        color: game.actionSignal.badgeColor,
                        border: `1px solid ${game.actionSignal.badgeColor}55`,
                        fontWeight: 700
                      }}
                      title={`${game.actionSignal.badgeLabel}: ${game.actionSignal.primaryReason}`}
                    >
                      {game.actionSignal.badgeLabel}
                    </span>
                  )}
                  {isConfirmedATL && !isHighRisk && !isProvisional && (
                    <span className="tag-pill tag-atl"><Flame size={10} /> ATL</span>
                  )}
                  {isHighRisk && (
                    <span className="tag-pill tag-risk"><AlertTriangle size={10} /> High Risk</span>
                  )}
                </div>
              </div>
            </div>

            {/* Middle: Store & Deal Score */}
            <div className="compact-mid">
              {hasBestDeal && dealScore > 0 && !isHighRisk && (
                <span 
                  className="compact-score-pill"
                  style={{ background: tierColor, cursor: 'pointer' }}
                  title={`Deal Score: ${dealScore}/100 • ${dealTier}`}
                  onClick={(e) => {
                    if (onExplain) {
                      e.stopPropagation();
                      onExplain(game);
                    }
                  }}
                >
                  {dealScore} • {dealTier}
                </span>
              )}

              {game.bestMerchantName && (
                <span className="compact-merchant" title={game.bestMerchantName}>
                  {game.bestMerchantIsOfficial && <ShieldCheck size={13} color="#10b981" />}
                  <span>{game.bestMerchantName}</span>
                </span>
              )}
            </div>

            {/* Right: Prices & Action */}
            <div className="compact-right">
              <div className="compact-pricing">
                {isFree ? (
                  <span className="free-badge">FREE</span>
                ) : hasBestDeal ? (
                  <>
                    <div className="compact-price-main">
                      <span className="compact-price">€{game.bestPriceEur?.toFixed(2)}</span>
                      {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
                        <span className="compact-discount">-{game.bestDiscountPercent}%</span>
                      )}
                      {game.bestIsFresh === false && (
                        <span 
                          className="stale-badge" 
                          style={{ 
                            fontSize: '0.68rem', 
                            fontWeight: 700, 
                            padding: '1px 5px', 
                            borderRadius: 4, 
                            background: 'rgba(148, 163, 184, 0.18)', 
                            color: 'var(--text-muted)', 
                            border: '1px solid rgba(148, 163, 184, 0.3)',
                            marginLeft: 4
                          }}
                          title="Stale fallback price (last observed >72h ago)"
                        >
                          Stale
                        </span>
                      )}
                    </div>
                    {game.basePriceEur && game.basePriceEur > (game.bestPriceEur || 0) && (
                      <span className="compact-msrp">€{game.basePriceEur.toFixed(2)}</span>
                    )}
                  </>
                ) : (
                  <span className="compact-untracked">€{game.basePriceEur?.toFixed(2) || '—'}</span>
                )}
              </div>

              <div className="compact-actions" onClick={e => e.stopPropagation()}>
                {game.bestDealUrl ? (
                  <a 
                    href={game.bestDealUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="btn btn-secondary btn-sm"
                    title="Direct store deal link"
                  >
                    <span>Deal</span>
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <button className="btn btn-outline btn-sm" onClick={() => onGameClick(game)}>
                    Details
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
