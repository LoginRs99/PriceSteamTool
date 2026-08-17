import React from 'react';
import type { Game, WishlistStatistics } from '../types.js';
import { Flame, TrendingDown, ShieldCheck, Tag, Sparkles, Trophy } from 'lucide-react';

interface DealsDashboardProps {
  stats: WishlistStatistics | null;
  topDeals: Game[];
  onSelectGame: (gameId: string) => void;
  onFilterATL: () => void;
  onFilterMajor: () => void;
  onFilterSale: () => void;
}

export const DealsDashboard: React.FC<DealsDashboardProps> = ({
  stats,
  topDeals,
  onSelectGame,
  onFilterATL,
  onFilterMajor,
  onFilterSale
}) => {
  if (!stats && topDeals.length === 0) return null;

  return (
    <div className="deals-dashboard">
      {/* 1. Objective Wishlist Statistics Bar */}
      {stats && (
        <div className="stats-bar-grid">
          <div className="stat-card" onClick={onFilterSale} style={{ cursor: 'pointer' }}>
            <div className="stat-card-header">
              <span className="stat-label">On Sale</span>
              <Tag size={16} color="#10b981" />
            </div>
            <div className="stat-value" style={{ color: '#10b981' }}>
              {stats.gamesOnSale}
              <span className="stat-sub">/ {stats.totalGames}</span>
            </div>
            <div className="stat-footer">
              {stats.totalGames > 0 
                ? `${Math.round((stats.gamesOnSale / stats.totalGames) * 100)}% of wishlist discounted` 
                : 'No games yet'}
            </div>
          </div>

          <div className="stat-card" onClick={onFilterATL} style={{ cursor: 'pointer' }}>
            <div className="stat-card-header">
              <span className="stat-label">All-Time Lows</span>
              <Flame size={16} color="#f59e0b" />
            </div>
            <div className="stat-value" style={{ color: '#f59e0b' }}>
              {stats.gamesAtHistoricalLow}
            </div>
            <div className="stat-footer">
              Confirmed record low prices
            </div>
          </div>

          <div className="stat-card" onClick={onFilterMajor} style={{ cursor: 'pointer' }}>
            <div className="stat-card-header">
              <span className="stat-label">Major Drops</span>
              <TrendingDown size={16} color="#8b5cf6" />
            </div>
            <div className="stat-value" style={{ color: '#a78bfa' }}>
              {stats.majorDropsCount}
            </div>
            <div className="stat-footer">
              Significant price drops (50%+)
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Avg. Discount</span>
              <Sparkles size={16} color="#38bdf8" />
            </div>
            <div className="stat-value" style={{ color: '#38bdf8' }}>
              {stats.averageDiscountPercent > 0 ? `-${stats.averageDiscountPercent}%` : '—'}
            </div>
            <div className="stat-footer">
              Across discounted wishlist items
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Data Safety</span>
              <ShieldCheck size={16} color="#10b981" />
            </div>
            <div className="stat-value" style={{ color: '#10b981', fontSize: 20 }}>
              {stats.gamesWithHighRiskOffers > 0 
                ? `${stats.gamesWithHighRiskOffers} Flagged` 
                : '100% Verified'}
            </div>
            <div className="stat-footer">
              {stats.gamesWithHighRiskOffers > 0 ? 'High-risk offers suppressed' : 'All prices consensus-checked'}
            </div>
          </div>
        </div>
      )}

      {/* 2. Best Deals Spotlight (Ordered by Best Value Score) */}
      {topDeals.length > 0 && (
        <div className="best-deals-section">
          <div className="best-deals-header">
            <div className="best-deals-title">
              <Trophy size={18} color="#f59e0b" />
              <span>Best Value Deals Right Now</span>
              <span className="deal-score-pill">Ranked by Balanced Deal Score</span>
            </div>
          </div>

          <div className="best-deals-grid">
            {topDeals.slice(0, 4).map((game) => {
              const score = game.bestDealScore ?? 0;
              const tier = game.bestDealTier || 'Fair';
              const isProvisional = Boolean(game.bestIsProvisional);

              const tierColor = 
                tier === 'Exceptional' ? '#8b5cf6' : 
                tier === 'Great' ? '#10b981' : 
                tier === 'Good' ? '#06b6d4' :
                tier === 'Fair' ? '#3b82f6' : '#64748b';

              return (
                <div 
                  key={game.id} 
                  className="spotlight-card" 
                  onClick={() => onSelectGame(game.id)}
                >
                  <div className="spotlight-img-wrap">
                    <img 
                      src={game.capsuleImage || game.headerImage || `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`} 
                      alt={game.title}
                      className="spotlight-img"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
                      <span className="spotlight-discount">
                        -{game.bestDiscountPercent}%
                      </span>
                    )}
                    <span 
                      className="spotlight-score-badge"
                      style={{ background: tierColor }}
                      title={`Deal Score: ${score}/100 • ${tier}`}
                    >
                      ★ {score} • {tier}
                    </span>
                  </div>

                  <div className="spotlight-body">
                    <h4 className="spotlight-title" title={game.title}>{game.title}</h4>
                    <div className="spotlight-price-row">
                      <div className="spotlight-prices">
                        {game.basePriceEur && game.bestPriceEur && game.basePriceEur > game.bestPriceEur && (
                          <span className="spotlight-orig-price">€{game.basePriceEur.toFixed(2)}</span>
                        )}
                        <span className="spotlight-best-price">€{game.bestPriceEur?.toFixed(2)}</span>
                      </div>
                      <span className="spotlight-store">{game.bestMerchantName || 'Steam'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
