import React from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { GameImage } from './GameImage.js';
import { ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';

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
              <GameImage 
                game={game} 
                alt={game.title} 
                className="compact-thumb" 
                type="capsule" 
              />
              <div className="compact-title-wrap">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="compact-title" title={game.title}>{game.title}</span>
                  {game.isFamilyShared && (
                    <span 
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'rgba(59, 130, 246, 0.15)',
                        color: '#60a5fa',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        whiteSpace: 'nowrap'
                      }}
                      title="Owned by a member of your Steam Family Library"
                    >
                      👨‍👩‍👧 Family
                    </span>
                  )}
                  {game.steamReviewPercent !== undefined && (
                    <span 
                      className={`steam-review-pill ${game.steamReviewPercent >= 80 ? 'positive' : game.steamReviewPercent >= 70 ? 'mixed' : 'negative'}`}
                      title={`Steam Reviews: ${game.steamReviewDesc || 'User Reviews'} (${game.steamReviewPercent}% positive${game.steamReviewTotal ? ` of ${game.steamReviewTotal}` : ''})`}
                    >
                      👍 {game.steamReviewPercent}%
                    </span>
                  )}
                  {game.steamdbRating !== undefined && (
                    <span 
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'rgba(56, 189, 248, 0.12)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        whiteSpace: 'nowrap'
                      }}
                      title={`SteamDB Rating: ${game.steamdbRating}% (Bayesian review-volume weighted score)`}
                    >
                      ⭐ {game.steamdbRating}%
                    </span>
                  )}
                  {game.metacriticScore !== undefined && (
                    <span 
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '1px 5px',
                        borderRadius: 'var(--radius-sm)',
                        background: game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.15)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: game.metacriticScore >= 75 ? '#4ade80' : game.metacriticScore >= 50 ? '#facc15' : '#f87171',
                        border: `1px solid ${game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.3)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        whiteSpace: 'nowrap'
                      }}
                      title={`Metacritic Score: ${game.metacriticScore}/100`}
                    >
                      M {game.metacriticScore}
                    </span>
                  )}
                </div>
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
              {game.bestPriceEvent === 'PRICING_ERROR' || (isHighRisk && (game.bestDiscountPercent ?? 0) >= 75) ? (
                <span 
                  className="compact-score-pill ticker-num"
                  style={{ 
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.3) 100%)', 
                    color: '#f87171', 
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    cursor: onExplain ? 'pointer' : 'default',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 800,
                    fontSize: '0.72rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.25)'
                  }}
                  title="⚡ Lehetséges Árhiba (Pricing Error) — Azonnali vétel javasolt, mielőtt a bolt korrigálja!"
                  onClick={(e) => {
                    if (onExplain) {
                      e.stopPropagation();
                      onExplain(game);
                    }
                  }}
                >
                  ⚡ GLITCH 99
                </span>
              ) : isHighRisk ? (
                <span 
                  className="compact-score-pill ticker-num"
                  style={{ 
                    background: 'rgba(245, 158, 11, 0.15)', 
                    color: '#f59e0b', 
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    cursor: onExplain ? 'pointer' : 'default',
                    padding: '2px 7px',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3
                  }}
                  title="Gyanús áranomália vagy elszigetelt kiugró ár — védelmi okokból elnyomva"
                  onClick={(e) => {
                    if (onExplain) {
                      e.stopPropagation();
                      onExplain(game);
                    }
                  }}
                >
                  <AlertTriangle size={11} /> Áranomália
                </span>
              ) : hasBestDeal && dealScore > 0 ? (
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
              ) : null}

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
