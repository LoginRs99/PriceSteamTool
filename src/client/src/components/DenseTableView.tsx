import React from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { ShieldCheck, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface DenseTableViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
  currentSort?: string;
  onSortChange?: (sort: any) => void;
}

export const DenseTableView: React.FC<DenseTableViewProps> = ({ 
  games, 
  onGameClick, 
  onExplain,
  currentSort,
  onSortChange 
}) => {
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
              style={{ width: 45, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('priority')}
              title="Sort by Steam Wishlist Priority"
            >
              # {renderSortIndicator('priority')}
            </th>
            <th 
              style={{ cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('title_asc')}
              title="Sort by Title Alphabetically"
            >
              Title {renderSortIndicator('title_asc')}
            </th>
            <th style={{ width: 120 }}>Trend</th>
            <th style={{ width: 85 }}>MSRP</th>
            <th 
              style={{ width: 105, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('price_asc', 'price_desc')}
              title="Sort by Best Deal Price"
            >
              Best Deal {renderSortIndicator('price_asc', 'price_desc')}
            </th>
            <th 
              style={{ width: 90, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('price_drops', 'discount_desc')}
              title="Sort by Highest Discount %"
            >
              Discount {renderSortIndicator('price_drops', 'discount_desc')}
            </th>
            <th 
              style={{ width: 130, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('best_value', 'deal_score_desc')}
              title="Sort by Deal Score (Best Value)"
            >
              Deal Score {renderSortIndicator('best_value', 'deal_score_desc')}
            </th>
            <th style={{ width: 140 }}>Best Store</th>
            <th 
              style={{ width: 95, cursor: onSortChange ? 'pointer' : 'default', userSelect: 'none' }}
              onClick={() => handleHeaderClick('near_atl')}
              title="Sort by All-Time Low Status"
            >
              ATL {renderSortIndicator('near_atl')}
            </th>
            <th style={{ width: 75, textAlign: 'right' }}>Action</th>
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

                {/* 2. Title & Single Priority Flag */}
                <td className="cell-title">
                  <div className="table-title-wrap">
                    <span className="table-game-title">{game.title}</span>
                    <div className="table-flags">
                      <TickerFlag game={game} />
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
                  {hasBestDeal && dealScore > 0 && !isHighRisk ? (
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
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 8. Best Store */}
                <td className="cell-store">
                  {game.bestMerchantName ? (
                    <div className="store-cell-content">
                      {game.bestMerchantIsOfficial && <ShieldCheck size={12} color="var(--down)" />}
                      <span className="store-name-text" title={game.bestMerchantName}>{game.bestMerchantName}</span>
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
                  {game.bestDealUrl ? (
                    <a 
                      href={game.bestDealUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="btn btn-secondary btn-xs"
                      title="Open deal in store"
                    >
                      Buy
                    </a>
                  ) : (
                    <button className="btn btn-outline btn-xs" onClick={() => onGameClick(game)}>
                      Info
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
