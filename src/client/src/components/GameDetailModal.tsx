import React, { useState, useEffect } from 'react';
import { PriceChart } from './PriceChart.js';
import { 
  X, 
  ExternalLink, 
  Copy, 
  Check,
  RefreshCw,
  Activity,
  Tag,
  Clock,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { useGameIntelligence } from './detail/useGameIntelligence.js';
import { DecisionHero } from './detail/DecisionHero.js';
import { TargetPriceEditor } from './detail/TargetPriceEditor.js';
import { PeriodLowsBar } from './detail/PeriodLowsBar.js';
import { IntelMetricsGrid } from './detail/IntelMetricsGrid.js';
import { OffersTable } from './detail/OffersTable.js';
import { AllKeyShopMatchSelector } from './detail/AllKeyShopMatchSelector.js';
import { PriceHistoryTable } from './detail/PriceHistoryTable.js';
import { GameDetailSkeleton } from './skeletons/GameDetailSkeleton.js';
import { getSteamReviewSentiment } from '../utils/steamMeta.js';
import { api } from '../api.js';

interface GameDetailModalProps {
  gameId: string;
  onClose: () => void;
  onTargetPriceUpdated?: (gameId: string, targetPriceEur: number | null) => void;
  onGameUpdated?: (gameId: string) => void;
  onNavigateGame?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export const GameDetailModal: React.FC<GameDetailModalProps> = ({ 
  gameId, 
  onClose, 
  onTargetPriceUpdated,
  onGameUpdated,
  onNavigateGame,
  hasPrev = false,
  hasNext = false
}) => {
  const {
    data,
    loading,
    copied,
    copiedVoucherId,
    targetPriceInput,
    setTargetPriceInput,
    savingTarget,
    targetSavedSuccess,
    aksCandidates,
    currentAksOverride,
    showAksSelector,
    customAksInput,
    setCustomAksInput,
    loadingAksCandidates,
    savingAksOverride,
    aksOverrideSuccess,
    handleOpenAksSelector,
    handleApplyAksOverride,
    handleCopySteamUrl,
    handleCopyVoucher,
    handleSaveTargetPrice,
    handleClearTargetPrice,
    refreshingGame,
    handleRefreshGame,
    togglingFamily,
    familyMessage,
    handleExcludeFamilySharing,
    handleIncludeFamilySharing,
    handleAutoCheckFamilySharing
  } = useGameIntelligence(gameId, onClose, onTargetPriceUpdated, onGameUpdated);

  const [activeTab, setActiveTab] = useState<'overview' | 'offers' | 'history'>('overview');
  const [recordedOfferId, setRecordedOfferId] = useState<string | null>(null);

  const handleRecordPurchase = async (offer: any) => {
    try {
      await api.recordPurchase({
        gameId,
        offerId: offer?.id,
        merchantId: offer?.merchantId,
        priceEur: Number(offer?.priceEur || 0)
      });
      setRecordedOfferId(offer?.id || 'manual');
      setTimeout(() => setRecordedOfferId(null), 3000);
    } catch (err) {
      console.error('Failed to record purchase:', err);
    }
  };

  useEffect(() => {
    if (!onNavigateGame) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isInput) return;

      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === ']') {
        if (hasNext) {
          e.preventDefault();
          onNavigateGame('next');
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === '[') {
        if (hasPrev) {
          e.preventDefault();
          onNavigateGame('prev');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigateGame, hasPrev, hasNext]);

  if (loading || !data) {
    return <GameDetailSkeleton onClose={onClose} />;
  }

  const { game, offers, history, intelligence } = data;
  const bestOffer = offers.find(o => o.isBestDeal) || offers[0];

  return (
    <div className="modal-overlay flyout-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="game-detail-title">
      <div className="modal-content modal-intel-content flyout-panel" onClick={e => e.stopPropagation()}>
        {/* Mobile Swipeable Bottom Sheet Handle */}
        <div className="bottom-sheet-drag-handle" aria-hidden="true" />

        {/* Modal Header */}
        <div className="modal-header">
          <div>
            <h2 id="game-detail-title" style={{ fontSize: 20, fontWeight: 800 }}>{game.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <a 
                href={`https://store.steampowered.com/app/${game.steamAppId}/`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                Steam Store (AppID: {game.steamAppId}) <ExternalLink size={12} />
              </a>

              {game.steamReviewPercent != null && (
                <span
                  className={`steam-review-pill ${getSteamReviewSentiment(game.steamReviewPercent)}`}
                  title={game.steamReviewDesc ? `${game.steamReviewDesc} (${game.steamReviewTotal?.toLocaleString() ?? 0} reviews)` : `${game.steamReviewPercent}% positive`}
                >
                  👍 {game.steamReviewPercent}% {game.steamReviewDesc ? `· ${game.steamReviewDesc}` : ''}
                </span>
              )}

              {game.steamdbRating != null && (
                <span
                  className="steamdb-rating-pill"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  title={`SteamDB Rating: ${game.steamdbRating}% (Bayesian review-volume weighted rating — protects against review bombing and small sample bias)`}
                >
                  ⭐ {game.steamdbRating}% SteamDB
                </span>
              )}

              {game.metacriticScore != null && (
                game.metacriticUrl ? (
                  <a
                    href={game.metacriticUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="metacritic-pill"
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.18)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                      color: game.metacriticScore >= 75 ? '#4ade80' : game.metacriticScore >= 50 ? '#facc15' : '#f87171',
                      border: `1px solid ${game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.35)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      textDecoration: 'none'
                    }}
                    title={`Metacritic Score: ${game.metacriticScore}/100 (Official Critic Consensus — click to view reviews)`}
                  >
                    <span style={{ fontWeight: 900, background: 'currentColor', color: '#000', borderRadius: 2, padding: '0 3px', fontSize: 10 }}>M</span> {game.metacriticScore} <ExternalLink size={10} />
                  </a>
                ) : (
                  <span
                    className="metacritic-pill"
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.18)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                      color: game.metacriticScore >= 75 ? '#4ade80' : game.metacriticScore >= 50 ? '#facc15' : '#f87171',
                      border: `1px solid ${game.metacriticScore >= 75 ? 'rgba(34, 197, 94, 0.35)' : game.metacriticScore >= 50 ? 'rgba(234, 179, 8, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    title={`Metacritic Score: ${game.metacriticScore}/100 (Official Critic Consensus)`}
                  >
                    <span style={{ fontWeight: 900, background: 'currentColor', color: '#000', borderRadius: 2, padding: '0 3px', fontSize: 10 }}>M</span> {game.metacriticScore}
                  </span>
                )
              )}

              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={handleCopySteamUrl}
                title="Copy Steam Store URL to clipboard"
              >
                {copied ? <Check size={11} color="var(--down)" /> : <Copy size={11} />}
                <span>{copied ? 'Copied URL!' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onNavigateGame && (
              <div className="flyout-nav-group" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => onNavigateGame('prev')}
                  disabled={!hasPrev}
                  style={{ padding: '6px 8px', minWidth: 32, justifyContent: 'center' }}
                  title="Previous game (Up Arrow / [ / k)"
                  aria-label="Previous game"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => onNavigateGame('next')}
                  disabled={!hasNext}
                  style={{ padding: '6px 8px', minWidth: 32, justifyContent: 'center' }}
                  title="Next game (Down Arrow / ] / j)"
                  aria-label="Next game"
                >
                  <ChevronDown size={15} />
                </button>
              </div>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleRefreshGame}
              disabled={refreshingGame}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}
              title="Refresh current prices for this game from all connected sources"
            >
              <RefreshCw size={13} className={refreshingGame ? 'spin-icon' : ''} />
              <span>{refreshingGame ? 'Refreshing...' : 'Refresh Prices'}</span>
            </button>
            <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Family Sharing Exclusion Banner / Controls */}
        {(game.isFamilyShared || game.isFamilyExcluded) && (
          <div 
            style={{
              margin: '12px 20px 0 20px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: game.isFamilyShared ? 'rgba(59, 130, 246, 0.08)' : 'rgba(234, 179, 8, 0.1)',
              border: `1px solid ${game.isFamilyShared ? 'rgba(59, 130, 246, 0.25)' : 'rgba(234, 179, 8, 0.3)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{game.isFamilyShared ? '👨‍👩‍👧' : '⚠️'}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: game.isFamilyShared ? '#60a5fa' : '#facc15' }}>
                  {game.isFamilyShared ? 'Family Sharing Active' : 'Excluded from Family Sharing'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {familyMessage ? familyMessage : game.isFamilyShared 
                    ? 'A family member owns this game. If Steam excludes it from sharing (e.g. EA/Ubisoft DRM), you can demark it.'
                    : 'This game is excluded from family sharing and will appear normally in your wishlist.'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {game.isFamilyShared ? (
                <>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => handleAutoCheckFamilySharing()}
                    disabled={togglingFamily}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    title="Check official Steam store metadata for Category 62 (Family Sharing)"
                  >
                    {togglingFamily ? 'Checking...' : 'Check Steam Support'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleExcludeFamilySharing('Excluded: not shared by Steam')}
                    disabled={togglingFamily}
                    style={{ fontSize: 12, padding: '4px 10px', background: 'rgba(234, 179, 8, 0.2)', color: '#facc15', border: '1px solid rgba(234, 179, 8, 0.4)' }}
                    title="Demark this game so it is not treated as family-shared"
                  >
                    {togglingFamily ? 'Updating...' : 'Demark (Not Shareable)'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => handleIncludeFamilySharing()}
                  disabled={togglingFamily}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  title="Restore family shared status"
                >
                  {togglingFamily ? 'Updating...' : 'Restore Family Status'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modal Navigation Tabs */}
        <div 
          className="modal-nav-tabs" 
          style={{ 
            display: 'flex', 
            gap: 4, 
            padding: '0 20px', 
            background: 'var(--bg-surface-elevated)', 
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap'
          }}
        >
          <button
            type="button"
            className={`modal-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 700,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'overview' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === 'overview' ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Activity size={14} color={activeTab === 'overview' ? 'var(--accent-blue)' : 'currentColor'} />
            <span>Overview & Advice</span>
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${activeTab === 'offers' ? 'active' : ''}`}
            onClick={() => setActiveTab('offers')}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 700,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'offers' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === 'offers' ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Tag size={14} color={activeTab === 'offers' ? 'var(--accent-blue)' : 'currentColor'} />
            <span>Store Offers ({offers.length})</span>
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
            style={{
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 700,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'history' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === 'history' ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Clock size={14} color={activeTab === 'history' ? 'var(--accent-blue)' : 'currentColor'} />
            <span>Price History ({history.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {/* TAB 1: OVERVIEW & INTELLIGENCE */}
          <div style={{ display: activeTab === 'overview' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
            {/* 1. Buy / Fair / Wait Decision Hero */}
            <DecisionHero 
              game={game}
              bestOffer={bestOffer}
              intelligence={intelligence}
              copiedVoucherId={copiedVoucherId}
              onCopyVoucher={handleCopyVoucher}
            />

            {/* 1.5 Target Price Discord Alert Configuration */}
            <TargetPriceEditor
              currentTargetPrice={game.targetPriceEur}
              targetPriceInput={targetPriceInput}
              savingTarget={savingTarget}
              targetSavedSuccess={targetSavedSuccess}
              intelligence={intelligence}
              allTimeLowEur={game.historicalLowEur}
              onInputChange={setTargetPriceInput}
              onSave={handleSaveTargetPrice}
              onClear={handleClearTargetPrice}
            />

            {/* 2. Rolling Period Lows Bar */}
            <PeriodLowsBar periodLows={intelligence?.periodLows} />

            {/* 3. Interactive Price History Chart */}
            {intelligence?.chartData && (
              <PriceChart data={intelligence.chartData} />
            )}

            {/* 4. Price Intelligence Metrics Grid */}
            <IntelMetricsGrid intelligence={intelligence} />
          </div>

          {/* TAB 2: STORE OFFERS & KEYSHOP MATCHING */}
          <div style={{ display: activeTab === 'offers' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
            {/* 5. All Available Offers Table */}
            <OffersTable 
              offers={offers}
              copiedVoucherId={copiedVoucherId}
              onCopyVoucher={handleCopyVoucher}
              onRecordPurchase={handleRecordPurchase}
              recordedOfferId={recordedOfferId}
            />

            {/* 5.5. AllKeyShop Candidate Discovery & Custom Match Selector */}
            <AllKeyShopMatchSelector
              showAksSelector={showAksSelector}
              loadingAksCandidates={loadingAksCandidates}
              savingAksOverride={savingAksOverride}
              aksOverrideSuccess={aksOverrideSuccess}
              aksCandidates={aksCandidates}
              currentAksOverride={currentAksOverride}
              customAksInput={customAksInput}
              onToggleSelector={handleOpenAksSelector}
              onApplyOverride={handleApplyAksOverride}
              onCustomInputChange={setCustomAksInput}
            />
          </div>

          {/* TAB 3: HISTORICAL OBSERVATIONS LOG */}
          <div style={{ display: activeTab === 'history' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
            {/* 6. Price History Table */}
            <PriceHistoryTable history={history} />
          </div>
        </div>
      </div>
    </div>
  );
};
