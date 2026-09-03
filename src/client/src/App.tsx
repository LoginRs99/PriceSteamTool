import React, { useEffect, useState, useCallback } from 'react';
import type { 
  Game, 
  ViewMode, 
  MainTab 
} from './types.js';
import { Navbar } from './components/Navbar.js';
import { SyncBanner } from './components/SyncBanner.js';
import { DealsDashboard } from './components/DealsDashboard.js';
import { FilterBar } from './components/FilterBar.js';
import { GameCard } from './components/GameCard.js';
import { CompactListView } from './components/CompactListView.js';
import { DenseTableView } from './components/DenseTableView.js';
import { FreeGamesView } from './components/FreeGamesView.js';
import { GameDetailModal } from './components/GameDetailModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { SourcesModal } from './components/SourcesModal.js';
import { AnomaliesView } from './components/AnomaliesView.js';
import { SyncModal } from './components/SyncModal.js';
import { DiscordModal } from './components/DiscordModal.js';
import { ScoreExplainModal } from './components/ScoreExplainModal.js';
import { GameCardSkeleton, CompactListSkeleton, DenseTableSkeleton } from './components/skeletons/index.js';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronsLeft, 
  ChevronsRight, 
  ArrowUp, 
  Gamepad2, 
  PlusCircle, 
  Sparkles, 
  Flame, 
  Gift, 
  LayoutGrid, 
  List, 
  Table as TableIcon, 
  AlertTriangle 
} from 'lucide-react';

import { useProfiles } from './hooks/useProfiles.js';
import { useWishlistGames } from './hooks/useWishlistGames.js';
import { useWishlistStats } from './hooks/useWishlistStats.js';
import { useWishlistSync } from './hooks/useWishlistSync.js';
import { useAnomalies } from './hooks/useAnomalies.js';

export const App: React.FC = () => {
  // Profiles
  const { profiles, activeProfile, loadProfiles } = useProfiles();

  // Navigation Tabs & View Mode
  const [mainTab, setMainTab] = useState<MainTab>('wishlist');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('pricetool_view_mode');
    return (saved === 'grid' || saved === 'list' || saved === 'table') ? saved : 'grid';
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('pricetool_view_mode', mode);
  };

  // Wishlist Games & Filtering
  const {
    games,
    setGames,
    totalGames,
    loading,
    error: gamesError,
    filters,
    updateFilters,
    loadGames
  } = useWishlistGames(activeProfile?.id);

  // Statistics, Top Deals, and Free Games
  const {
    stats,
    topDeals,
    setTopDeals,
    freeGames,
    loadStatsAndDeals,
    loadFreeGames
  } = useWishlistStats(activeProfile?.id);

  // Anomalies
  const { anomalies, loadAnomalies } = useAnomalies();

  // Sync state & SSE Stream
  const handleSyncCompleted = useCallback(() => {
    loadGames();
    loadStatsAndDeals();
    loadFreeGames();
    loadAnomalies();
  }, [loadGames, loadStatsAndDeals, loadFreeGames, loadAnomalies]);

  const { syncProgress, handleExecuteSync, handleCancelSync } = useWishlistSync(handleSyncCompleted);

  // Modals
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [explainGame, setExplainGame] = useState<Game | null>(null);
  const [showProfilesModal, setShowProfilesModal] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Scroll to top
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 350);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPages = Math.ceil(totalGames / (filters.limit || 50)) || 1;
  const currentPage = filters.page || 1;

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <Navbar
        activeProfile={activeProfile}
        syncProgress={syncProgress}
        onOpenProfiles={() => setShowProfilesModal(true)}
        onOpenSources={() => setShowSourcesModal(true)}
        onOpenDiscord={() => setShowDiscordModal(true)}
        onTriggerSync={() => setShowSyncModal(true)}
      />

      {/* Sync Progress Banner */}
      <SyncBanner progress={syncProgress} onCancel={handleCancelSync} />

      {/* Main Content */}
      {!activeProfile ? (
        <div className="empty-state">
          <Gamepad2 size={48} color="#10b981" />
          <h2 className="empty-title">No Steam Profile Configured</h2>
          <p className="empty-desc">
            Add your Steam profile (by Steam64 ID or Profile URL) to start tracking deals across your entire wishlist.
          </p>
          <button 
            className="btn btn-primary"
            onClick={() => setShowProfilesModal(true)}
          >
            <PlusCircle size={16} />
            <span>Add Steam Profile</span>
          </button>
        </div>
      ) : (
        <>
          {/* Main Navigation Tabs */}
          <div className="main-tabs-bar">
            <button
              className={`main-tab-btn ${mainTab === 'wishlist' ? 'active' : ''}`}
              onClick={() => setMainTab('wishlist')}
            >
              <Gamepad2 size={16} />
              <span>Wishlist Deals</span>
              <span className="tab-count-badge">{stats?.totalGames ?? totalGames}</span>
            </button>

            <button
              className={`main-tab-btn ${mainTab === 'free' ? 'active' : ''}`}
              onClick={() => {
                setMainTab('free');
                loadFreeGames();
              }}
            >
              <Gift size={16} color="#10b981" />
              <span>Free to Play</span>
              <span className="tab-count-badge free-tab-badge">{stats?.freeGamesCount ?? freeGames.length}</span>
            </button>

            <button
              className={`main-tab-btn ${mainTab === 'deals' ? 'active' : ''}`}
              onClick={() => setMainTab('deals')}
            >
              <Sparkles size={16} color="#f59e0b" />
              <span>Top Best Deals</span>
              <span className="tab-count-badge deals-tab-badge">{topDeals.length}</span>
            </button>

            <button
              className={`main-tab-btn ${mainTab === 'safety' ? 'active' : ''}`}
              onClick={() => {
                setMainTab('safety');
                loadAnomalies();
              }}
            >
              <AlertTriangle size={16} color={anomalies.length > 0 ? '#f87171' : '#f59e0b'} />
              <span>Data Safety</span>
              <span className={`tab-count-badge ${anomalies.length > 0 ? 'safety-tab-badge' : ''}`}>
                {anomalies.length}
              </span>
            </button>
          </div>

          {/* TAB 1: PAID WISHLIST VIEW */}
          {mainTab === 'wishlist' && (
            <>
              <DealsDashboard
                stats={stats}
                topDeals={topDeals}
                onSelectGame={(id) => setSelectedGameId(id)}
                onFilterATL={() => updateFilters({ allTimeLowOnly: true, majorDealsOnly: false, saleOnly: false, page: 1 })}
                onFilterMajor={() => updateFilters({ majorDealsOnly: true, allTimeLowOnly: false, saleOnly: false, page: 1 })}
                onFilterSale={() => updateFilters({ saleOnly: true, majorDealsOnly: false, allTimeLowOnly: false, page: 1 })}
              />

              <FilterBar
                filters={filters}
                totalGames={totalGames}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                onFilterChange={updateFilters}
              />

              {gamesError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '14px 18px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  color: 'var(--text, #fff)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <AlertTriangle size={20} color="#f87171" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '14px', color: '#fca5a5' }}>
                      {gamesError}
                    </span>
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={() => loadGames()}
                    style={{ fontSize: '13px', padding: '6px 14px', whiteSpace: 'nowrap' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {loading && games.length === 0 ? (
                viewMode === 'grid' ? (
                  <div className="games-grid">
                    <GameCardSkeleton count={8} />
                  </div>
                ) : viewMode === 'list' ? (
                  <CompactListSkeleton rows={8} />
                ) : (
                  <DenseTableSkeleton rows={8} />
                )
              ) : !loading && games.length === 0 ? (
                <div className="empty-state">
                  <Gamepad2 size={40} color="var(--text-muted)" />
                  <h3 className="empty-title">No games found</h3>
                  <p className="empty-desc">
                    {totalGames === 0 
                      ? 'Your wishlist is currently empty. Click "Sync Wishlist" to fetch your Steam wishlist.'
                      : 'No games match your current search and filter settings.'}
                  </p>
                  {totalGames === 0 && (
                    <button className="btn btn-primary" onClick={() => setShowSyncModal(true)}>
                      <span>Sync Wishlist Now</span>
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s ease' }}>
                  {viewMode === 'grid' && (
                    <div className="games-grid">
                      {games.map(game => (
                        <GameCard
                          key={game.id}
                          game={game}
                          onClick={() => setSelectedGameId(game.id)}
                          onExplain={(g) => setExplainGame(g)}
                        />
                      ))}
                    </div>
                  )}

                  {viewMode === 'list' && (
                    <CompactListView
                      games={games}
                      onGameClick={(game) => setSelectedGameId(game.id)}
                      onExplain={(g) => setExplainGame(g)}
                    />
                  )}

                  {viewMode === 'table' && (
                    <DenseTableView
                      games={games}
                      onGameClick={(game) => setSelectedGameId(game.id)}
                      onExplain={(g) => setExplainGame(g)}
                      currentSort={filters.sort}
                      onSortChange={(sort) => updateFilters({ sort, page: 1 })}
                    />
                  )}

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="pagination">
                      {totalPages > 2 && (
                        <button
                          className="btn btn-secondary"
                          disabled={currentPage <= 1}
                          onClick={() => updateFilters({ page: 1 })}
                          title="First Page"
                          aria-label="First Page"
                        >
                          <ChevronsLeft size={16} />
                        </button>
                      )}

                      <button
                        className="btn btn-secondary"
                        disabled={currentPage <= 1}
                        onClick={() => updateFilters({ page: currentPage - 1 })}
                        title="Previous Page"
                        aria-label="Previous Page"
                      >
                        <ChevronLeft size={16} />
                        <span>Previous</span>
                      </button>

                      <span className="page-info">
                        Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({totalGames} paid games)
                      </span>

                      <button
                        className="btn btn-secondary"
                        disabled={currentPage >= totalPages}
                        onClick={() => updateFilters({ page: currentPage + 1 })}
                        title="Next Page"
                        aria-label="Next Page"
                      >
                        <span>Next</span>
                        <ChevronRight size={16} />
                      </button>

                      {totalPages > 2 && (
                        <button
                          className="btn btn-secondary"
                          disabled={currentPage >= totalPages}
                          onClick={() => updateFilters({ page: totalPages })}
                          title="Last Page"
                          aria-label="Last Page"
                        >
                          <ChevronsRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* TAB 2: FREE TO PLAY GAMES */}
          {mainTab === 'free' && (
            <FreeGamesView
              games={freeGames}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              onGameClick={(game) => setSelectedGameId(game.id)}
            />
          )}

          {/* TAB 3: TOP BEST DEALS SHOWCASE */}
          {mainTab === 'deals' && (
            <div className="best-deals-tab-view">
              <div className="deals-header" style={{ marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Flame size={20} color="#f59e0b" />
                    <span>Top Ranked Deals (Best Value)</span>
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                    Ranked by verified Deal Score algorithms for maximum savings.
                  </p>
                </div>

                <div className="view-mode-group" role="group" aria-label="View Mode">
                  <button
                    className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                    onClick={() => handleViewModeChange('grid')}
                    title="Grid View"
                    aria-label="Grid View"
                  >
                    <LayoutGrid size={16} />
                  </button>
                  <button
                    className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                    onClick={() => handleViewModeChange('list')}
                    title="Compact List View"
                    aria-label="Compact List View"
                  >
                    <List size={16} />
                  </button>
                  <button
                    className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                    onClick={() => handleViewModeChange('table')}
                    title="Dense Table View"
                    aria-label="Dense Table View"
                  >
                    <TableIcon size={16} />
                  </button>
                </div>
              </div>

              {topDeals.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <Sparkles size={32} color="#f59e0b" />
                  <h3 className="empty-title">No Active Deals Found</h3>
                  <p className="empty-desc">No discounted games are currently recorded. Run a sync to find deals.</p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="games-grid">
                  {topDeals.map(game => (
                    <GameCard
                      key={game.id}
                      game={game}
                      onClick={() => setSelectedGameId(game.id)}
                      onExplain={(g) => setExplainGame(g)}
                    />
                  ))}
                </div>
              ) : viewMode === 'list' ? (
                <CompactListView
                  games={topDeals}
                  onGameClick={(game) => setSelectedGameId(game.id)}
                  onExplain={(g) => setExplainGame(g)}
                />
              ) : (
                <DenseTableView
                  games={topDeals}
                  onGameClick={(game) => setSelectedGameId(game.id)}
                  onExplain={(g) => setExplainGame(g)}
                />
              )}
            </div>
          )}

          {/* TAB 4: DATA SAFETY (ANOMALIES) VIEW */}
          {mainTab === 'safety' && (
            <AnomaliesView
              onRefresh={() => {
                loadAnomalies();
                loadGames();
                loadFreeGames();
                loadStatsAndDeals();
              }}
            />
          )}
        </>
      )}

      {/* Modals */}
      {selectedGameId && (
        <GameDetailModal
          gameId={selectedGameId}
          onClose={() => setSelectedGameId(null)}
          onTargetPriceUpdated={(gameId, targetPrice) => {
            setGames(prev => prev.map(g => g.id === gameId ? { ...g, targetPriceEur: targetPrice === null ? undefined : targetPrice } : g));
            setTopDeals(prev => prev.map(g => g.id === gameId ? { ...g, targetPriceEur: targetPrice === null ? undefined : targetPrice } : g));
          }}
          onGameUpdated={() => {
            loadGames();
            loadStatsAndDeals();
          }}
        />
      )}

      {explainGame && (
        <ScoreExplainModal
          game={explainGame}
          onClose={() => setExplainGame(null)}
        />
      )}

      {showProfilesModal && (
        <ProfileModal
          profiles={profiles}
          activeProfile={activeProfile}
          onClose={() => setShowProfilesModal(false)}
          onRefresh={async () => {
            await loadProfiles();
            loadGames();
            loadFreeGames();
            loadStatsAndDeals();
          }}
        />
      )}

      {showSourcesModal && (
        <SourcesModal onClose={() => setShowSourcesModal(false)} />
      )}

      {showSyncModal && (
        <SyncModal
          onClose={() => setShowSyncModal(false)}
          onStartSync={handleExecuteSync}
          isSyncing={syncProgress?.status === 'RUNNING'}
        />
      )}

      {showDiscordModal && (
        <DiscordModal
          isOpen={showDiscordModal}
          onClose={() => setShowDiscordModal(false)}
        />
      )}

      {/* Floating Scroll to Top Button */}
      {showScrollTop && (
        <button
          className="scroll-to-top-btn"
          onClick={scrollToTop}
          title="Scroll back to top"
          aria-label="Scroll back to top"
        >
          <ArrowUp size={16} />
          <span>Top</span>
        </button>
      )}
    </div>
  );
};
