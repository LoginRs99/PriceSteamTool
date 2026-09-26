import React, { useCallback, useState } from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { GameImage } from './GameImage.js';
import { ShieldCheck, ChevronRight, RefreshCw } from 'lucide-react';
import { getSteamReviewSentiment } from '../utils/steamMeta.js';
import { useCurrency } from '../context/CurrencyContext.js';

interface CompactRowProps {
  game: Game;
  index: number;
  isRefreshing: boolean;
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
  onRefresh?: (e: React.MouseEvent, gameId: string) => void;
  formatPrice: (eurVal: number | null | undefined) => string;
}

const CompactRowComponent: React.FC<CompactRowProps> = ({
  game,
  index,
  isRefreshing,
  onGameClick,
  onExplain,
  onRefresh,
  formatPrice
}) => {
  const hasBestDeal = game.bestPriceEur !== undefined;
  const isFree = game.isFree || game.bestPriceEur === 0;
  const dealScore = game.bestDealScore ?? 0;
  const dealTier = game.bestDealTier || 'Fair';

  const tierBg = 
    dealTier === 'Exceptional' ? 'rgba(167, 139, 250, 0.25)' : 
    dealTier === 'Great' ? 'var(--down-dim)' : 
    dealTier === 'Good' ? 'rgba(56, 189, 248, 0.2)' :
    'rgba(107, 114, 128, 0.2)';

  const tierColor = 
    dealTier === 'Exceptional' ? 'var(--accent-purple)' : 
    dealTier === 'Great' ? 'var(--down)' : 
    dealTier === 'Good' ? 'var(--accent-blue)' :
    'var(--dim)';

  const isAtl = Boolean(
    game.bestPriceEvent === 'NEW_HISTORICAL_LOW' ||
    game.bestPriceEvent === 'AT_HISTORICAL_LOW' ||
    (game.historicalLowEur !== undefined && game.bestPriceEur !== undefined && game.bestPriceEur <= game.historicalLowEur)
  );
  const hasAnomaly = Boolean(game.hasPricingError || game.bestPriceEvent === 'PRICING_ERROR');
  const rowClass = `compact-row ${hasAnomaly ? 'row-glitch' : isAtl ? 'row-atl' : ''}`.trim();

  return (
    <div
      className={rowClass}
      onClick={() => onGameClick(game)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onGameClick(game);
        }
      }}
      aria-label={`${game.title}, best price ${formatPrice(game.bestPriceEur)}`}
    >
      {/* Left: Priority, Thumbnail, Title, Meta */}
      <div className="compact-left">
        <span className="compact-priority" title="Rank Position">
          #{index + 1}
        </span>

        <GameImage
          game={game}
          alt=""
          className="compact-thumb"
          type="capsule"
        />

        <div className="compact-title-wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                className={`steam-review-pill ${getSteamReviewSentiment(game.steamReviewPercent)}`}
                title={`Steam Reviews: ${game.steamReviewDesc || 'User Reviews'} (${game.steamReviewPercent}% positive)`}
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
                title={`SteamDB Rating: ${game.steamdbRating}%`}
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

      {/* Mid: Trend sparkline, Deal Score, Store badge */}
      <div className="compact-mid">
        <div style={{ width: 90, height: 20, flexShrink: 0 }}>
          <Sparkline game={game} width={90} height={20} />
        </div>

        {hasAnomaly ? (
          <button
            type="button"
            className="compact-score-pill score-chip-glitch"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              cursor: onExplain ? 'pointer' : 'default'
            }}
            onClick={(e) => {
              if (onExplain) {
                e.stopPropagation();
                onExplain(game);
              }
            }}
            title="Pricing anomaly detected"
          >
            ⚡ GLITCH
          </button>
        ) : hasBestDeal && dealScore > 0 && (
          <button
            type="button"
            className="compact-score-pill"
            style={{ 
              background: tierBg, 
              color: tierColor, 
              border: `1px solid ${tierColor}`, 
              cursor: onExplain ? 'pointer' : 'default' 
            }}
            onClick={(e) => {
              if (onExplain) {
                e.stopPropagation();
                onExplain(game);
              }
            }}
            title="Click to view Deal Score Breakdown"
          >
            ★ {dealScore} • {dealTier}
          </button>
        )}

        <div 
          className={`compact-merchant ${game.bestMerchantIsOfficial ? 'official' : 'keyshop'}`} 
          title={`${game.bestMerchantIsOfficial ? 'Official Store' : 'Keyshop'}: ${game.bestMerchantName || 'Steam'}`}
        >
          {game.bestMerchantIsOfficial && (
            <ShieldCheck size={12} color="var(--down)" style={{ flexShrink: 0 }} />
          )}
          <span>{game.bestMerchantName || 'Steam'}</span>
          {game.bestIsFresh === false && (
            <span 
              className="stale-badge" 
              style={{ 
                fontSize: '0.65rem', 
                fontWeight: 700, 
                padding: '1px 4px', 
                borderRadius: 3, 
                background: 'rgba(245, 158, 11, 0.15)', 
                color: 'var(--signal)', 
                border: '1px solid rgba(245, 158, 11, 0.3)' 
              }}
              title="Price was fetched in a previous sync and may have changed"
            >
              Stale
            </span>
          )}
        </div>
      </div>

      {/* Right: Pricing, Actions */}
      <div className="compact-right">
        <div className="compact-pricing">
          {isFree ? (
            <span className="free-badge-sm">FREE</span>
          ) : hasBestDeal ? (
            <>
              <div className="compact-price-main">
                <span className="compact-price">{formatPrice(game.bestPriceEur)}</span>
                {game.bestDiscountPercent !== undefined && game.bestDiscountPercent > 0 && (
                  <span className="compact-discount">-{game.bestDiscountPercent}%</span>
                )}
              </div>
              {Boolean(game.basePriceEur && game.basePriceEur > (game.bestPriceEur || 0)) && (
                <span className="compact-msrp">{formatPrice(game.basePriceEur)}</span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>—</span>
          )}
        </div>

        {onRefresh && (
          <button
            type="button"
            className="btn btn-outline"
            style={{ padding: '4px 6px', height: 28 }}
            onClick={(e) => onRefresh(e, game.id)}
            disabled={isRefreshing}
            title="Refresh price from all sources"
            aria-label={`Refresh price for ${game.title}`}
          >
            <RefreshCw size={12} className={isRefreshing ? 'spin-icon' : ''} />
          </button>
        )}

        <ChevronRight size={16} color="var(--text-dim)" style={{ flexShrink: 0 }} />
      </div>
    </div>
  );
};

const CompactRow = React.memo(CompactRowComponent);

interface CompactListViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
  onExplain?: (game: Game) => void;
  onRefreshGame?: (gameId: string) => Promise<void> | void;
}

const CompactListViewComponent: React.FC<CompactListViewProps> = ({
  games,
  onGameClick,
  onExplain,
  onRefreshGame
}) => {
  const { formatPrice } = useCurrency();
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());

  const handleRefresh = useCallback(async (e: React.MouseEvent, gameId: string) => {
    e.stopPropagation();
    if (!onRefreshGame || refreshingIds.has(gameId)) return;

    setRefreshingIds(prev => new Set(prev).add(gameId));
    try {
      await onRefreshGame(gameId);
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(gameId);
        return next;
      });
    }
  }, [onRefreshGame, refreshingIds]);

  if (games.length === 0) {
    return (
      <div className="compact-empty-state" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>No games to display in compact view.</p>
      </div>
    );
  }

  return (
    <div className="compact-list-container" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {games.map((game, index) => (
        <CompactRow
          key={game.id}
          game={game}
          index={index}
          isRefreshing={refreshingIds.has(game.id)}
          onGameClick={onGameClick}
          onExplain={onExplain}
          onRefresh={onRefreshGame ? handleRefresh : undefined}
          formatPrice={formatPrice}
        />
      ))}
    </div>
  );
};

export const CompactListView = React.memo(CompactListViewComponent);
