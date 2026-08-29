import React from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { ShieldCheck, ExternalLink } from 'lucide-react';

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

        const tierColor = 
          dealTier === 'Exceptional' ? 'var(--accent-purple)' : 
          dealTier === 'Great' ? 'var(--down)' : 
          dealTier === 'Good' ? 'var(--accent-blue)' :
          'var(--dim)';

        const tierBg = 
          dealTier === 'Exceptional' ? 'rgba(167, 139, 250, 0.15)' : 
          dealTier === 'Great' ? 'var(--down-dim)' : 
          dealTier === 'Good' ? 'rgba(56, 189, 248, 0.15)' :
          'rgba(107, 114, 128, 0.15)';

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
                <span className="compact-priority ticker-num">#{game.priority}</span>
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
                  <TickerFlag game={game} />
                </div>
              </div>
            </div>

            {/* Sparkline Column */}
            <div className="compact-sparkline-wrap" style={{ width: 100, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
              <Sparkline game={game} width={100} height={20} />
            </div>

            {/* Middle: Store & Deal Score */}
            <div className="compact-mid">
              {hasBestDeal && dealScore > 0 && !isHighRisk && (
                <span 
                  className="compact-score-pill ticker-num"
                  style={{ 
                    background: tierBg, 
                    color: tierColor, 
                    border: `1px solid ${tierColor}44`,
                    cursor: 'pointer',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 700,
                    fontSize: '0.75rem'
                  }}
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
                  {game.bestMerchantIsOfficial && <ShieldCheck size={13} color="var(--down)" />}
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
                      <span className="compact-price ticker-num">€{game.bestPriceEur?.toFixed(2)}</span>
                      {game.bestIsFresh === false && (
                        <span 
                          className="stale-badge" 
                          style={{ 
                            fontSize: '0.68rem', 
                            fontWeight: 700, 
                            padding: '1px 5px', 
                            borderRadius: 4, 
                            background: 'rgba(148, 163, 184, 0.18)', 
                            color: 'var(--dim)', 
                            border: '1px solid var(--line)',
                            marginLeft: 4
                          }}
                          title="Stale fallback price (last observed >72h ago)"
                        >
                          Stale
                        </span>
                      )}
                    </div>
                    {game.basePriceEur && game.basePriceEur > (game.bestPriceEur || 0) && (
                      <span className="compact-msrp ticker-num" style={{ color: 'var(--dim-2)' }}>€{game.basePriceEur.toFixed(2)}</span>
                    )}
                  </>
                ) : (
                  <span className="compact-untracked ticker-num">€{game.basePriceEur?.toFixed(2) || '—'}</span>
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
