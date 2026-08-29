import React, { useState } from 'react';
import type { Game } from '../types.js';
import { Sparkline } from './Sparkline.js';
import { TickerFlag } from './TickerFlag.js';
import { AlertTriangle, ShieldCheck, Info, Gamepad2, ExternalLink, Copy, Check, XCircle } from 'lucide-react';

interface GameCardProps {
  game: Game;
  onClick: () => void;
  onExplain?: (game: Game) => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onClick, onExplain }) => {
  const [imgError, setImgError] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);
  const [copiedSteam, setCopiedSteam] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const imageUrl = game.capsuleImage || 
    game.headerImage || 
    `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`;

  const hasBestDeal = game.bestPriceEur !== undefined;
  const isFree = game.isFree || game.bestPriceEur === 0;
  
  // Deal Score & Rail Color
  const dealScore = game.bestDealScore ?? 0;
  const dealTier = game.bestDealTier || 'Fair';

  // Rail color by tier / status
  const isConfirmedATL = (game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || game.bestPriceEvent === 'AT_HISTORICAL_LOW') && !game.bestIsProvisional;
  const isHighRisk = game.bestRiskLevel === 'HIGH' || game.hasAnomaly;

  const railColor = isHighRisk 
    ? 'var(--up)' 
    : isConfirmedATL 
    ? 'var(--signal)' 
    : dealTier === 'Exceptional' || dealTier === 'Great' 
    ? 'var(--down)' 
    : dealTier === 'Good' 
    ? 'var(--accent-blue)' 
    : 'var(--dim)';

  const tierBadgeBg = 
    dealTier === 'Exceptional' ? 'rgba(167, 139, 250, 0.2)' : 
    dealTier === 'Great' ? 'var(--down-dim)' : 
    dealTier === 'Good' ? 'rgba(56, 189, 248, 0.15)' :
    'rgba(107, 114, 128, 0.15)';

  const tierBadgeColor = 
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
        {!imgError ? (
          <img 
            src={imageUrl} 
            alt={game.title} 
            className="game-card-image"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              if (!triedFallback) {
                setTriedFallback(true);
                target.src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
              } else {
                setImgError(true);
              }
            }}
          />
        ) : (
          <div 
            className="game-card-image" 
            style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              background: 'linear-gradient(135deg, var(--surface-hover) 0%, var(--surface) 100%)',
              color: 'var(--dim)',
              gap: 6
            }}
          >
            <Gamepad2 size={24} style={{ opacity: 0.6 }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0 8px', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>
              {game.title}
            </span>
          </div>
        )}

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
        <div className="deal-badge-cluster" style={{ position: 'absolute', top: 8, left: 8, zIndex: 3 }}>
          <TickerFlag game={game} />
        </div>

        {/* Top-Right: Deal Score & Tier Pill */}
        {hasBestDeal && (
          <div 
            className="deal-score-badge"
            style={{ 
              position: 'absolute',
              top: 8,
              right: 8,
              background: tierBadgeBg, 
              color: tierBadgeColor,
              border: `1px solid ${tierBadgeColor}44`,
              borderRadius: 'var(--radius-sm)',
              padding: '2px 7px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              fontWeight: 700,
              zIndex: 3,
              cursor: onExplain && dealScore > 0 ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            title={`Deal Score: ${dealScore}/100 • ${dealTier}${game.bestMerchantName ? ` (${game.bestMerchantName})` : ''}`}
            onClick={(e) => {
              if (onExplain && dealScore > 0) {
                e.stopPropagation();
                onExplain(game);
              }
            }}
          >
            {dealScore > 0 ? (
              <>
                <span className="deal-score-num ticker-num">{dealScore}</span>
                <span className="deal-score-tier-label">{dealTier}</span>
              </>
            ) : (
              <span className="deal-score-tier-label">
                {game.bestMerchantName || 'Best Deal'}
              </span>
            )}
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

        {/* Bottom-Left: Action Signal Pill (Must Buy, Buy, Wait, etc.) */}
        {game.actionSignal && !isHighRisk && (
          <div 
            className="action-signal-pill" 
            style={{ 
              position: 'absolute', 
              bottom: 8, 
              left: 8, 
              background: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${game.actionSignal.badgeColor}88`,
              color: game.actionSignal.badgeColor,
              padding: '4px 9px',
              borderRadius: 6,
              fontSize: '0.74rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              zIndex: 3,
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)'
            }}
            title={`${game.actionSignal.badgeLabel}: ${game.actionSignal.primaryReason}`}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: game.actionSignal.badgeColor, boxShadow: `0 0 6px ${game.actionSignal.badgeColor}` }} />
            <span>{game.actionSignal.badgeLabel}</span>
          </div>
        )}
      </div>

      {/* Card Content */}
      <div className="game-card-body">
        <div>
          <h3 className="game-title" title={game.title}>
            {game.title}
          </h3>

          {/* Context Line: Explain savings vs typical sale or historical low */}
          <div className="hist-context-line" style={{ fontSize: '0.78rem', color: 'var(--dim)', marginTop: 3 }}>
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
