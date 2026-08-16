import React from 'react';
import type { Game } from '../types.js';
import { Flame, AlertTriangle, ShieldCheck } from 'lucide-react';

interface DenseTableViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
}

export const DenseTableView: React.FC<DenseTableViewProps> = ({ games, onGameClick, onExplain }) => {
  return (
    <div className="dense-table-wrapper">
      <table className="dense-table">
        <thead>
          <tr>
            <th style={{ width: 45 }}>#</th>
            <th>Title</th>
            <th style={{ width: 90 }}>MSRP</th>
            <th style={{ width: 100 }}>Best Deal</th>
            <th style={{ width: 75 }}>Discount</th>
            <th style={{ width: 120 }}>Deal Score</th>
            <th style={{ width: 130 }}>Best Store</th>
            <th style={{ width: 90 }}>ATL</th>
            <th style={{ width: 80, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {games.map(game => {
            const hasBestDeal = game.bestPriceEur !== undefined;
            const isFree = game.isFree || game.bestPriceEur === 0;
            const dealScore = game.bestDealScore ?? 0;
            const dealTier = game.bestDealTier || 'Fair';
            const confidence = game.bestConfidenceScore ?? 50;
            const isProvisional = Boolean(game.bestIsProvisional);

            const tierColor = 
              dealTier === 'Exceptional' ? '#8b5cf6' : 
              dealTier === 'Great' ? '#10b981' : 
              dealTier === 'Good' ? '#06b6d4' :
              dealTier === 'Fair' ? '#3b82f6' : '#64748b';

            const isConfirmedATL = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW';
            const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;

            return (
              <tr 
                key={game.id} 
                className="dense-table-row"
                onClick={() => onGameClick(game)}
              >
                {/* 1. Priority */}
                <td className="cell-priority">
                  {game.priority !== undefined ? `#${game.priority}` : '—'}
                </td>

                {/* 2. Title & Flags */}
                <td className="cell-title">
                  <div className="table-title-wrap">
                    <span className="table-game-title">{game.title}</span>
                    <div className="table-flags">
                      {game.actionSignal && !isHighRisk && (
                        <span 
                          className="mini-flag" 
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
                        <span className="mini-flag atl-mini" title="All-Time Low"><Flame size={10} /> ATL</span>
                      )}
                      {isHighRisk && (
                        <span className="mini-flag risk-mini" title="High Risk Suppressed"><AlertTriangle size={10} /> Risk</span>
                      )}
                    </div>
                  </div>
                </td>

                {/* 3. Steam MSRP */}
                <td className="cell-msrp">
                  {game.basePriceEur ? `€${game.basePriceEur.toFixed(2)}` : '—'}
                </td>

                {/* 4. Best Deal Price */}
                <td className="cell-price">
                  {isFree ? (
                    <span className="free-badge-sm">FREE</span>
                  ) : hasBestDeal ? (
                    <span className="price-bold">€{game.bestPriceEur?.toFixed(2)}</span>
                  ) : (
                    <span className="text-dim">No deal</span>
                  )}
                </td>

                {/* 5. Discount % */}
                <td className="cell-discount">
                  {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 ? (
                    <span className="discount-tag-sm">-{game.bestDiscountPercent}%</span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 6. Deal Score */}
                <td className="cell-score">
                  {hasBestDeal && dealScore > 0 && !isHighRisk ? (
                    <span 
                      className="score-chip-sm"
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
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 7. Best Store */}
                <td className="cell-store">
                  {game.bestMerchantName ? (
                    <div className="store-cell-content">
                      {game.bestMerchantIsOfficial && <ShieldCheck size={12} color="#10b981" />}
                      <span className="store-name-text" title={game.bestMerchantName}>{game.bestMerchantName}</span>
                    </div>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 8. Historical Low */}
                <td className="cell-atl">
                  {game.historicalLowEur !== undefined ? (
                    <span className="atl-text">€{game.historicalLowEur.toFixed(2)}</span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>

                {/* 9. Action */}
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
