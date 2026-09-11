import React, { useState } from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { GameImage } from './GameImage.js';
import { AlertTriangle, ShieldCheck, Info, ExternalLink, Copy, Check, XCircle } from 'lucide-react';
import { getSteamReviewSentiment } from '../utils/steamMeta.js';

interface GameCardProps {
  game: Game;
  onClick: () => void;
  onExplain?: (game: Game) => void;
}

const GameCardComponent: React.FC<GameCardProps> = ({ game, onClick, onExplain }) => {
  const [copiedSteam, setCopiedSteam] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const hasBestDeal = game.bestPriceEur !== undefined;
  const isFree = game.isFree || game.bestPriceEur === 0;
  
  // Deal Score & Rail Color
  const dealScore = game.bestDealScore ?? 0;
  const dealTier = game.bestDealTier || 'Fair';

  // Rail color by tier / status
  const isConfirmedATL = (game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW') && !game.bestIsProvisional;
  const isHighRisk = Boolean(game.hasPricingError);
  const isPricingError = game.bestPriceEvent === 'PRICING_ERROR' || (isHighRisk && (game.bestDiscountPercent ?? 0) >= 75);

  const railColor = isPricingError
    ? '#ef4444'
    : isHighRisk 
    ? 'var(--up)' 
    : isConfirmedATL 
    ? 'var(--signal)' 
    : dealTier === 'Exceptional' || dealTier === 'Great' 
    ? 'var(--down)' 
    : dealTier === 'Good' 
    ? 'var(--accent-blue)' 
    : 'var(--dim)';

  const tierBadgeBg = 
    isPricingError ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(220, 38, 38, 0.4) 100%)' :
    dealTier === 'Exceptional' ? 'rgba(167, 139, 250, 0.2)' : 
    dealTier === 'Great' ? 'var(--down-dim)' : 
    dealTier === 'Good' ? 'rgba(56, 189, 248, 0.15)' :
    'rgba(107, 114, 128, 0.15)';

  const tierBadgeColor = 
    isPricingError ? '#f87171' :
    dealTier === 'Exceptional' ? 'var(--accent-purple)' : 
    dealTier === 'Great' ? 'var(--down)' : 
    dealTier === 'Good' ? 'var(--accent-blue)' :
    'var(--dim)';

  // Real context savings
  const savingVsMedian = game.bestSavingVsMedianEur;
  const typicalMedian = game.typicalSaleMedianEur;

  const handleCopySteam = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(`https://store.steampowered.com/app/${game.steamAppId}/`);
      setCopiedSteam(true);
      setCopyError(false);
      setTimeout(() => setCopiedSteam(false), 1800);
    } catch (err) {
      console.warn('Failed to copy Steam URL to clipboard:', err);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2500);
    }
  };

  return (
    <div className="game-card" onClick={onClick}>
      {/* Cover Image Container */}
      <div className="game-card-image-wrap" style={{ position: 'relative', overflow: 'hidden' }}>
        <GameImage 
          game={game} 
          alt={game.title} 
          className="game-card-image" 
          type="header" 
        />

        {/* Mini Sparkline Overlay at bottom of image */}
        <div 
          style={{ 
            position: 'absolute', 
            bottom: 3, 
            left: 0, 
            right: 0, 
            height: 26, 
            background: 'linear-gradient(to top, rgba(10, 11, 14, 0.85) 0%, transparent 100%)', 
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'flex-end',
            paddingBottom: 2
          }}
        >
          <Sparkline game={game} width="100%" height={22} />
        </div>

        {/* 3px Bottom Color Rail */}
        <div 
          className="ticker-score-rail" 
          style={{ backgroundColor: railColor }} 
        />

        {/* Top-Left: Single Priority Flag (ATL > Target Hit > Discount) */}
        <div className="deal-badge-cluster" style={{ position: 'absolute', top: 8, left: 8, zIndex: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
          <TickerFlag game={game} />
          {game.isFamilyShared && (
            <span 
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(30, 58, 138, 0.85)',
                color: '#93c5fd',
                border: '1px solid rgba(147, 197, 253, 0.4)',
                backdropFilter: 'blur(4px)',
                whiteSpace: 'nowrap'
              }}
              title="Owned by a member of your Steam Family Library"
            >
              👨‍👩‍👧 Family
            </span>
          )}
        </div>

        {/* Top-Right: Deal Score Pill (Numeric Score Only) */}
        {hasBestDeal && (dealScore > 0 || isPricingError) && (
          <div 
            className="deal-score-badge"
            style={{ 
              position: 'absolute',
              top: 8,
              right: 8,
              background: tierBadgeBg, 
              color: tierBadgeColor,
              border: isPricingError ? '1px solid #ef4444' : `1px solid ${tierBadgeColor}44`,
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              fontWeight: 800,
              zIndex: 3,
              cursor: onExplain ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 26,
              boxShadow: isPricingError ? '0 0 8px rgba(239, 68, 68, 0.4)' : undefined
            }}
            title={isPricingError 
              ? "⚡ Potential Pricing Error — Immediate purchase recommended before store correction!"
              : `Deal Score: ${dealScore}/100 • ${dealTier}${game.bestMerchantName ? ` (${game.bestMerchantName})` : ''}`}
            onClick={(e) => {
              if (onExplain) {
                e.stopPropagation();
                onExplain(game);
              }
            }}
          >
            <span className="deal-score-num ticker-num">{isPricingError ? '⚡' : dealScore}</span>
          </div>
        )}

        {/* Touch & Hover Quick Action Bar */}
        <div className="game-card-quick-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className={`quick-action-btn ${copiedSteam ? 'active-pop' : ''}`}
            title={copiedSteam ? 'Steam URL Copied!' : copyError ? 'Failed to copy Steam URL' : 'Copy Steam Store URL'}
            aria-label={copiedSteam ? 'Steam URL copied to clipboard' : copyError ? 'Failed to copy Steam URL' : `Copy Steam store link for ${game.title}`}
            onClick={handleCopySteam}
          >
            {copiedSteam ? <Check size={13} color="#10b981" /> : copyError ? <XCircle size={13} color="#ef4444" /> : <Copy size={13} />}
          </button>

          {game.bestDealUrl && (
            <a
              href={game.bestDealUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="quick-action-btn"
              title={`Open direct deal page at ${game.bestMerchantName || 'Store'}`}
              aria-label={`Open direct deal page for ${game.title} at ${game.bestMerchantName || 'Store'}`}
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>


      </div>

      {/* Card Content */}
      <div className="game-card-body">
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
            <h3 className="game-title" title={game.title} style={{ margin: 0, flex: 1 }}>
              {game.title}
            </h3>
            {/* Primary Rating Badge (Consolidated to prevent title crushing; full breakdown available in tooltip & modal) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginTop: 1 }}>
              {game.steamReviewPercent !== undefined ? (
                <span 
                  className={`steam-review-pill ${getSteamReviewSentiment(game.steamReviewPercent)}`}
                  title={`Steam Reviews: ${game.steamReviewDesc || 'User Reviews'} (${game.steamReviewPercent}% positive${game.steamReviewTotal ? ` of ${game.steamReviewTotal}` : ''})${game.steamdbRating !== undefined ? ` • SteamDB: ${game.steamdbRating}%` : ''}${game.metacriticScore !== undefined ? ` • Metacritic: ${game.metacriticScore}/100` : ''}`}
                >
                  👍 {game.steamReviewPercent}%
                </span>
              ) : game.steamdbRating !== undefined ? (
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
                  title={`SteamDB Rating: ${game.steamdbRating}% (Bayesian weighted)${game.metacriticScore !== undefined ? ` • Metacritic: ${game.metacriticScore}/100` : ''}`}
                >
                  ⭐ {game.steamdbRating}%
                </span>
              ) : game.metacriticScore !== undefined ? (
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
              ) : null}
            </div>
          </div>

          {/* Context Line: Selective Mega/Great Deal Badge & savings vs typical */}
          <div className="hist-context-line" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--dim)', marginTop: 4 }}>
            {dealTier === 'Exceptional' && (
              <span 
                className="deal-tier-tag tier-tag-exceptional" 
                style={{
                  background: 'rgba(167, 139, 250, 0.2)',
                  color: 'var(--accent-purple)',
                  border: '1px solid rgba(167, 139, 250, 0.4)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3
                }}
              >
                🔥 MEGA DEAL
              </span>
            )}
            {dealTier === 'Great' && (
              <span 
                className="deal-tier-tag tier-tag-great" 
                style={{
                  background: 'var(--down-dim)',
                  color: 'var(--down)',
                  border: '1px solid rgba(34, 211, 165, 0.35)',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3
                }}
              >
                ✨ GREAT DEAL
              </span>
            )}

            {savingVsMedian && savingVsMedian > 0 && typicalMedian ? (
              <span style={{ color: 'var(--down)', fontWeight: 600 }}>
                €{savingVsMedian.toFixed(2)} below typical (€{typicalMedian.toFixed(2)})
              </span>
            ) : isConfirmedATL ? (
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
                ★ Matches All-Time Low
              </span>
            ) : game.historicalLowEur !== undefined ? (
              <span className="ticker-num">Hist. Low: €{game.historicalLowEur.toFixed(2)}</span>
            ) : (
              <span>Standard catalog price</span>
            )}
          </div>
        </div>

        {/* Primary Price & Merchant Row */}
        <div className="game-meta-row" style={{ marginTop: 'auto', paddingTop: 8 }}>
          <div className="price-block">
            {game.basePriceEur && game.bestPriceEur && game.basePriceEur > game.bestPriceEur && (
              <span className="original-price ticker-num" style={{ color: 'var(--dim-2)' }}>
                €{game.basePriceEur.toFixed(2)}
              </span>
            )}
            <span className={`best-price ticker-num ${(game.bestDiscountPercent || 0) > 0 ? 'on-sale' : ''}`}>
              {isFree ? 'FREE' : hasBestDeal ? `€${game.bestPriceEur!.toFixed(2)}` : '—'}
            </span>
            {hasBestDeal && game.bestIsFresh === false && (
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
                  marginLeft: 4,
                  verticalAlign: 'middle'
                }}
                title="Stale fallback price (last observed >72h ago)"
              >
                Stale
              </span>
            )}
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
                aria-label={`Explain deal score for ${game.title}`}
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

export const GameCard = React.memo(GameCardComponent);
