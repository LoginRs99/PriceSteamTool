import React from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { GameImage } from './GameImage.js';
import { ShieldCheck, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, RefreshCw } from 'lucide-react';

interface DenseTableViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
  currentSort?: string;
  onSortChange?: (sort: any) => void;
  onRefreshGame?: (gameId: string) => Promise<void> | void;
}

export const DenseTableView: React.FC<DenseTableViewProps> = ({ 
  games, 
  onGameClick, 
  onExplain,
  currentSort,
  onSortChange,
  onRefreshGame
}) => {
  const [refreshingId, setRefreshingId] = React.useState<string | null>(null);
  const handleHeaderClick = (primarySort: string, altSort: string = primarySort) => {
    if (!onSortChange) return;
    if (currentSort === primarySort) {
      onSortChange(altSort !== primarySort ? altSort : 'best_value');
    } else if (currentSort === altSort) {
      onSortChange('best_value');
    } else {
      onSortChange(primarySort);
    }
  };

  const renderSortIndicator = (primarySort: string, altSort?: string) => {
    if (currentSort === primarySort) return <ArrowDown size={12} style={{ display: 'inline', marginLeft: 4, color: 'var(--down)' }} />;
    if (altSort && currentSort === altSort) return <ArrowUp size={12} style={{ display: 'inline', marginLeft: 4, color: 'var(--down)' }} />;
    return <ArrowUpDown size={11} style={{ display: 'inline', marginLeft: 4, opacity: 0.35 }} />;
  };

  return (
    <div className="dense-table-wrapper">
      <table className="dense-table">
        <thead>
          <tr>
            <th 
              className="th-priority"
              style={{ width: 45, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('priority')}
              title="Sort by Steam Wishlist Priority"
            >
              # {renderSortIndicator('priority')}
            </th>
            <th 
              className="th-title"
              style={{ cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('title_asc')}
              title="Sort by Title Alphabetically"
            >
              Title {renderSortIndicator('title_asc')}
            </th>
            <th className="th-sparkline" style={{ width: 120 }}>Trend</th>
            <th className="th-msrp" style={{ width: 85 }}>MSRP</th>
            <th 
              className="th-price"
              style={{ width: 105, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('price_asc', 'price_desc')}
              title="Sort by Best Deal Price"
            >
              Best Deal {renderSortIndicator('price_asc', 'price_desc')}
            </th>
            <th 
              className="th-discount"
              style={{ width: 90, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('price_drops', 'discount_desc')}
              title="Sort by Highest Discount %"
            >
              Discount {renderSortIndicator('price_drops', 'discount_desc')}
            </th>
            <th 
              className="th-score"
              style={{ width: 130, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('best_value', 'deal_score_desc')}
              title="Sort by Deal Score (Best Value)"
            >
              Deal Score {renderSortIndicator('best_value', 'deal_score_desc')}
            </th>
            <th className="th-store" style={{ width: 145 }}>Best Store</th>
            <th 
              className="th-atl"
              style={{ width: 95, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('near_atl')}
              title="Sort by All-Time Low Status"
            >
              ATL {renderSortIndicator('near_atl')}
            </th>
            <th className="th-action" style={{ width: 75, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
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
              <tr 
                key={game.id} 
                className="dense-table-row"
                onClick={() => onGameClick(game)}
              >
                {/* 1. Priority */}
                <td className="cell-priority ticker-num">
                  {game.priority !== undefined ? `#${game.priority}` : '—'}
                </td>

                {/* 2. Capsule + Title & Flag */}
                <td className="cell-title">
                  <div className="table-title-wrap">
                    <GameImage
                      game={game}
                      alt=""
                      className="table-capsule-img"
                      type="capsule"
                    />
                    <div className="table-title-inner">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="table-game-title">{game.title}</span>
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
                            title={`Metacritic Critic Score: ${game.metacriticScore}/100`}
                          >
                            M {game.metacriticScore}
                          </span>
                        )}
                      </div>
                      <div className="table-flags">
                        <TickerFlag game={game} />
                      </div>
                    </div>
                  </div>
                </td>

                {/* 3. Sparkline Trend */}
                <td className="cell-sparkline" style={{ padding: '4px 8px' }}>
                  <Sparkline game={game} width={110} height={20} />
                </td>

                {/* 4. Steam MSRP */}
                <td className="cell-msrp ticker-num" style={{ color: 'var(--dim-2)' }}>
                  {game.basePriceEur ? `€${game.basePriceEur.toFixed(2)}` : '—'}
                </td>

                {/* 5. Best Deal Price */}
                <td className="cell-price ticker-num">
                  {isFree ? (
                    <span className="free-badge-sm">FREE</span>
                  ) : hasBestDeal ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="price-bold" style={{ color: (game.bestDiscountPercent || 0) > 0 ? 'var(--down)' : 'var(--ink)' }}>
                        €{game.bestPriceEur?.toFixed(2)}
                      </span>
                      {game.bestIsFresh === false && (
                        <span 
                          className="stale-badge" 
                          style={{ 
                            fontSize: '0.65rem', 
                            fontWeight: 700, 
                            padding: '1px 4px', 
                            borderRadius: 3, 
                            background: 'rgba(148, 163, 184, 0.18)', 
                            color: 'var(--dim)', 
                            border: '1px solid var(--line)' 
                          }}
                          title="Stale fallback price (last observed >72h ago)"
                        >
                          Stale
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dim">No deal</span>
                  )}
                </td>

                {/* 6. Discount % */}
                <td className="cell-discount ticker-num">
                  {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 ? (
                    <span className="discount-tag-sm" style={{ color: 'var(--down)', fontWeight: 700 }}>
                      -{game.bestDiscountPercent}%
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 7. Deal Score */}
                <td className="cell-score">
                  {game.bestPriceEvent === 'PRICING_ERROR' || (isHighRisk && (game.bestDiscountPercent ?? 0) >= 75) ? (
                    <span 
                      className="score-chip-sm ticker-num"
                      style={{ 
                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.3) 100%)', 
                        color: '#f87171', 
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        cursor: onExplain ? 'pointer' : 'default',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 800,
                        fontSize: '0.72rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        boxShadow: '0 0 6px rgba(239, 68, 68, 0.25)'
                      }}
                      title="⚡ Potential Pricing Error — Immediate purchase recommended before store correction!"
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
                      className="score-chip-sm ticker-num"
                      style={{ 
                        background: 'rgba(245, 158, 11, 0.15)', 
                        color: '#f59e0b', 
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        cursor: onExplain ? 'pointer' : 'default',
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                      title="Suspicious price anomaly or isolated outlier — suppressed for safety"
                      onClick={(e) => {
                        if (onExplain) {
                          e.stopPropagation();
                          onExplain(game);
                        }
                      }}
                    >
                      <AlertTriangle size={11} /> Anomaly
                    </span>
                  ) : hasBestDeal && dealScore > 0 ? (
                    <span 
                      className="score-chip-sm ticker-num"
                      style={{ 
                        background: tierBg, 
                        color: tierColor, 
                        border: `1px solid ${tierColor}44`,
                        cursor: 'pointer',
                        padding: '2px 6px',
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
                  ) : isFree ? (
                    <span className="text-dim" style={{ fontSize: '0.75rem' }} title="Free Game">Free</span>
                  ) : hasBestDeal ? (
                    <span className="text-dim" style={{ fontSize: '0.75rem' }} title="No active discount (full price)">Full price</span>
                  ) : (
                    <span className="text-dim" style={{ fontSize: '0.75rem' }} title="Awaiting price sync">—</span>
                  )}
                </td>

                {/* 8. Best Store */}
                <td className="cell-store">
                  {game.bestMerchantName ? (
                    <div className="store-cell-content">
                      {game.bestMerchantIsOfficial ? (
                        <span className="store-pill official" title={`${game.bestMerchantName} (Official Store)`}>
                          <ShieldCheck size={12} color="var(--down)" />
                          <span className="store-name-text">{game.bestMerchantName}</span>
                        </span>
                      ) : (
                        <span className="store-pill keyshop" title={`${game.bestMerchantName} (Keyshop)`}>
                          <span className="store-name-text">{game.bestMerchantName}</span>
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 9. Historical Low */}
                <td className="cell-atl ticker-num">
                  {game.historicalLowEur !== undefined ? (
                    <span className="atl-text" style={{ color: 'var(--dim)' }}>€{game.historicalLowEur.toFixed(2)}</span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 10. Action */}
                <td className="cell-action" onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    {onRefreshGame && (
                      <button
                        type="button"
                        disabled={refreshingId === game.id}
                        className="btn btn-outline btn-xs"
                        style={{ padding: '3px 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Refresh prices now for this game"
                        aria-label={`Refresh prices for ${game.title}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setRefreshingId(game.id);
                          try {
                            await onRefreshGame(game.id);
                          } finally {
                            setRefreshingId(null);
                          }
                        }}
                      >
                        <RefreshCw size={11} className={refreshingId === game.id ? 'spin-icon' : ''} />
                      </button>
                    )}
                    {game.bestDealUrl ? (
                      <a 
                        href={game.bestDealUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="btn btn-primary btn-xs"
                        title="Open deal in store"
                      >
                        Buy
                      </a>
                    ) : (
                      <button className="btn btn-outline btn-xs" onClick={() => onGameClick(game)}>
                        Info
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
