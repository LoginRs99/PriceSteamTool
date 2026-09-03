import React from 'react';
import { PriceChart } from './PriceChart.js';
import { 
  X, 
  ExternalLink, 
  Copy, 
  Check 
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

interface GameDetailModalProps {
  gameId: string;
  onClose: () => void;
  onTargetPriceUpdated?: (gameId: string, targetPriceEur: number | null) => void;
  onGameUpdated?: (gameId: string) => void;
}

export const GameDetailModal: React.FC<GameDetailModalProps> = ({ 
  gameId, 
  onClose, 
  onTargetPriceUpdated,
  onGameUpdated
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
    handleClearTargetPrice
  } = useGameIntelligence(gameId, onClose, onTargetPriceUpdated, onGameUpdated);

  if (loading || !data) {
    return <GameDetailSkeleton onClose={onClose} />;
  }

  const { game, offers, history, intelligence } = data;
  const bestOffer = offers.find(o => o.isBestDeal) || offers[0];

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="game-detail-title">
      <div className="modal-content modal-intel-content" onClick={e => e.stopPropagation()}>
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
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {/* 1. Buy / Fair / Wait Decision Hero */}
          <DecisionHero 
            game={game}
            bestOffer={bestOffer}
            intelligence={intelligence}
          />

          {/* 1.5 Target Price Discord Alert Configuration */}
          <TargetPriceEditor
            currentTargetPrice={game.targetPriceEur}
            targetPriceInput={targetPriceInput}
            savingTarget={savingTarget}
            targetSavedSuccess={targetSavedSuccess}
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

          {/* 5. All Available Offers Table */}
          <OffersTable 
            offers={offers}
            copiedVoucherId={copiedVoucherId}
            onCopyVoucher={handleCopyVoucher}
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

          {/* 6. Price History Table */}
          <PriceHistoryTable history={history} />
        </div>
      </div>
    </div>
  );
};
