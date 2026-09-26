import React from 'react';
import type { Game, WishlistStatistics, WishlistFilterOptions } from '../types.js';
import { GameImage } from './GameImage.js';
import { Flame, TrendingDown, ShieldCheck, Tag, Sparkles, Trophy } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext.js';

interface DealsDashboardProps {
  stats: WishlistStatistics | null;
  topDeals: Game[];
  onSelectGame: (gameId: string) => void;
  onFilterATL: () => void;
  onFilterMajor: () => void;
  onFilterSale: () => void;
  filters?: WishlistFilterOptions;
}

const DealsDashboardComponent: React.FC<DealsDashboardProps> = ({
  stats,
  topDeals,
  onSelectGame,
  onFilterATL,
  onFilterMajor,
  onFilterSale,
  filters
}) => {
  const { formatPrice } = useCurrency();
  if (!stats && topDeals.length === 0) return null;

  const isSaleActive = Boolean(filters?.saleOnly && !filters?.allTimeLowOnly && !filters?.majorDealsOnly);
  const isAtlActive = Boolean(filters?.allTimeLowOnly);
  const isMajorActive = Boolean(filters?.majorDealsOnly);

  return (
    <div className="deals-dashboard">
      {/* 1. Objective Wishlist Statistics Ribbon */}
      {stats && (
        <div className="stats-bar-grid">
          <div 
            className={`stat-card ${isSaleActive ? 'active-sale' : ''}`} 
            onClick={onFilterSale} 
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFilterSale();
              }
            }}
            aria-pressed={isSaleActive}
            title={isSaleActive ? 'Filter active: showing games on sale (click to toggle off)' : 'Click to filter games on sale'}
          >
            <div className="stat-card-header">
              <span className="stat-label">On Sale</span>
              <Tag size={13} color="#10b981" />
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

          <div 
            className={`stat-card ${isAtlActive ? 'active-atl' : ''}`} 
            onClick={onFilterATL} 
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFilterATL();
              }
            }}
            aria-pressed={isAtlActive}
            title={isAtlActive ? 'Filter active: showing All-Time Lows (click to toggle off)' : 'Click to filter confirmed All-Time Lows'}
          >
            <div className="stat-card-header">
              <span className="stat-label">All-Time Lows</span>
              <Flame size={13} color="#f59e0b" />
            </div>
            <div className="stat-value" style={{ color: '#f59e0b' }}>
              {stats.gamesAtHistoricalLow}
            </div>
            <div className="stat-footer">
              Confirmed record low prices
            </div>
          </div>

          <div 
            className={`stat-card ${isMajorActive ? 'active-major' : ''}`} 
            onClick={onFilterMajor} 
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFilterMajor();
              }
            }}
            aria-pressed={isMajorActive}
            title={isMajorActive ? 'Filter active: showing Mega & Major Drops (click to toggle off)' : 'Click to filter 50%+ drops and Mega Deals'}
          >
            <div className="stat-card-header">
              <span className="stat-label">Mega & Major Deals</span>
              <TrendingDown size={13} color="#8b5cf6" />
            </div>
            <div className="stat-value" style={{ color: '#a78bfa' }}>
              {stats.majorDropsCount}
            </div>
            <div className="stat-footer">
              50%+ drops or Mega Deals
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Avg. Discount</span>
              <Sparkles size={13} color="#38bdf8" />
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
              <ShieldCheck size={13} color="#10b981" />
            </div>
            <div className="stat-value" style={{ color: '#10b981' }}>
              {stats.gamesWithPricingErrors > 0 
                ? `${stats.gamesWithPricingErrors} Flagged` 
                : '100% Verified'}
            </div>
            <div className="stat-footer">
              {stats.gamesWithPricingErrors > 0 ? 'Pricing errors suppressed' : 'All prices consensus-checked'}
            </div>
          </div>
        </div>
      )}

      {/* 2. Compact Best Deals Spotlight */}
      {topDeals.length > 0 && (
        <div className="best-deals-section">
          <div className="best-deals-header">
            <div className="best-deals-title">
              <Trophy size={14} color="#f59e0b" />
              <span>Best Value Deals Right Now</span>
              <span className="deal-score-pill">Ranked by Balanced Deal Score</span>
            </div>
          </div>

          <div className="best-deals-grid">
            {topDeals.slice(0, 4).map((game) => {
              const score = game.bestDealScore ?? 0;
              const tier = game.bestDealTier || 'Fair';

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
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectGame(game.id);
                    }
                  }}
                >
                  <div className="spotlight-img-wrap">
                    <GameImage
                      game={game}
                      alt={game.title}
                      className="spotlight-img"
                      type="header"
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
                      ★ {score} • {tier === 'Exceptional' ? 'Mega Deal' : tier === 'Great' ? 'Great Deal' : tier === 'Good' ? 'Good Deal' : tier}
                    </span>
                  </div>

                  <div className="spotlight-body">
                    <h4 className="spotlight-title" title={game.title}>{game.title}</h4>
                    <div className="spotlight-price-row">
                      <div className="spotlight-prices">
                        {Boolean(game.basePriceEur && game.bestPriceEur && game.basePriceEur > game.bestPriceEur) && (
                          <span className="spotlight-orig-price">{formatPrice(game.basePriceEur)}</span>
                        )}
                        <span className="spotlight-best-price">{formatPrice(game.bestPriceEur)}</span>
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

export const DealsDashboard = React.memo(DealsDashboardComponent);
