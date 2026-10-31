import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import type { 
  Game, 
  MainTab,
  ViewMode 
} from './types.js';
import { Navbar } from './components/Navbar.js';
import { api } from './api.js';
import { SyncBanner } from './components/SyncBanner.js';
import { DealsDashboard } from './components/DealsDashboard.js';
import { FilterBar } from './components/FilterBar.js';
import { CompactListView } from './components/CompactListView.js';
import { GameCard } from './components/GameCard.js';
import { ViewModeToggle } from './components/filter/ViewModeToggle.js';

const FreeGamesView = React.lazy(() => import('./components/FreeGamesView.js').then(m => ({ default: m.FreeGamesView })));
const GameDetailModal = React.lazy(() => import('./components/GameDetailModal.js').then(m => ({ default: m.GameDetailModal })));
const ProfileModal = React.lazy(() => import('./components/ProfileModal.js').then(m => ({ default: m.ProfileModal })));
const SourcesModal = React.lazy(() => import('./components/SourcesModal.js').then(m => ({ default: m.SourcesModal })));
const AnomaliesView = React.lazy(() => import('./components/AnomaliesView.js').then(m => ({ default: m.AnomaliesView })));
const SyncModal = React.lazy(() => import('./components/SyncModal.js').then(m => ({ default: m.SyncModal })));
const DiscordModal = React.lazy(() => import('./components/DiscordModal.js').then(m => ({ default: m.DiscordModal })));
const ScoreExplainModal = React.lazy(() => import('./components/ScoreExplainModal.js').then(m => ({ default: m.ScoreExplainModal })));
const SavingsView = React.lazy(() => import('./components/SavingsView.js').then(m => ({ default: m.SavingsView })));

import { GameCardSkeleton, CompactListSkeleton, DenseTableSkeleton, SavingsSkeleton } from './components/skeletons/index.js';
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
  AlertTriangle,
  PiggyBank,
  RefreshCw 
} from 'lucide-react';

import { useProfiles } from './hooks/useProfiles.js';
import { useWishlistGames } from './hooks/useWishlistGames.js';
import { useWishlistStats } from './hooks/useWishlistStats.js';
import { useWishlistSync } from './hooks/useWishlistSync.js';
import { useAnomalies } from './hooks/useAnomalies.js';

export const App: React.FC = () => {
  // Profiles
  const { profiles, activeProfile, loadProfiles } = useProfiles();

  // Navigation Tabs
  const [mainTab, setMainTab] = useState<MainTab>('wishlist');

  // View Mode: compact (ticker rows) or grid (poster cards)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('pricetool_view_mode');
      if (saved === 'grid' || saved === 'compact') return saved;
      return 'compact';
    } catch {
      return 'compact';
    }
  });

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('pricetool_view_mode', mode);
    } catch {
      // ignore
    }
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
    loadGames(undefined, true);
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
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const handleCloseDetailModal = useCallback(() => setSelectedGameId(null), []);
  const handleCloseExplainModal = useCallback(() => setExplainGame(null), []);
  const handleCloseProfilesModal = useCallback(() => setShowProfilesModal(false), []);
  const handleCloseSourcesModal = useCallback(() => setShowSourcesModal(false), []);
  const handleCloseDiscordModal = useCallback(() => setShowDiscordModal(false), []);
  const handleCloseSyncModal = useCallback(() => setShowSyncModal(false), []);

  const handleOpenProfiles = useCallback(() => setShowProfilesModal(true), []);
  const handleOpenSources = useCallback(() => setShowSourcesModal(true), []);
  const handleOpenDiscord = useCallback(() => setShowDiscordModal(true), []);
  const handleOpenSync = useCallback(() => setShowSyncModal(true), []);
  const handleLogoClick = useCallback(() => setMainTab('wishlist'), []);

  const handleSelectGame = useCallback((id: string) => {
    setSelectedGameId(id);
  }, []);

  const handleExplainGame = useCallback((game: Game) => {
    setExplainGame(game);
  }, []);

  const handleGameClick = useCallback((game: Game) => {
    setSelectedGameId(game.id);
  }, []);

  const handleTargetPriceUpdated = useCallback((gameId: string, targetPrice: number | null) => {
    setGames(prev => prev.map(g => g.id === gameId ? { ...g, targetPriceEur: targetPrice === null ? undefined : targetPrice } : g));
    setTopDeals(prev => prev.map(g => g.id === gameId ? { ...g, targetPriceEur: targetPrice === null ? undefined : targetPrice } : g));
  }, []);

  const currentNavList = useMemo(() => {
    if (mainTab === 'deals') return topDeals;
    return games;
  }, [mainTab, topDeals, games]);

  const currentNavIndex = currentNavList.findIndex(g => g.id === selectedGameId);
  const hasPrevGame = currentNavIndex > 0;
  const hasNextGame = currentNavIndex >= 0 && currentNavIndex < currentNavList.length - 1;

  const handleNavigateGame = useCallback((direction: 'prev' | 'next') => {
    const list = mainTab === 'deals' ? topDeals : games;
    const idx = list.findIndex(g => g.id === selectedGameId);
    if (idx === -1) return;
    const targetIdx = direction === 'next' ? idx + 1 : idx - 1;
    if (targetIdx >= 0 && targetIdx < list.length) {
      setSelectedGameId(list[targetIdx].id);
    }
  }, [mainTab, topDeals, games, selectedGameId]);

  const handleGameUpdated = useCallback(() => {
    loadGames(undefined, true);
    loadStatsAndDeals();
  }, [loadGames, loadStatsAndDeals]);

  const handleProfileRefresh = useCallback(async () => {
    await loadProfiles();
    loadGames();
    loadFreeGames();
    loadStatsAndDeals();
  }, [loadProfiles, loadGames, loadFreeGames, loadStatsAndDeals]);

  // Global Keyboard Navigation: j / k list navigation when no modal is open
  useEffect(() => {
    if (selectedGameId || explainGame || showProfilesModal || showSourcesModal || showDiscordModal || showSyncModal) {
      return;
    }

    const handleListKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'SELECT' || 
        target.isContentEditable
      );
      if (isInput) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
        return;
      }

      if (e.key === 'r') {
        e.preventDefault();
        handleOpenSync();
        return;
      }

      if (e.key === '1') {
        e.preventDefault();
        setMainTab('wishlist');
        return;
      } else if (e.key === '2') {
        e.preventDefault();
        setMainTab('free');
        loadFreeGames();
        return;
      } else if (e.key === '3') {
        e.preventDefault();
        setMainTab('deals');
        return;
      } else if (e.key === '4') {
        e.preventDefault();
        setMainTab('safety');
        loadAnomalies();
        return;
      } else if (e.key === '5') {
        e.preventDefault();
        setMainTab('savings');
        return;
      }

      if (e.key === 'j' || e.key === 'k') {
        const items = Array.from(document.querySelectorAll<HTMLElement>('.compact-row, .game-card'));
        if (items.length === 0) return;

        e.preventDefault();
        const activeIdx = items.findIndex(el => el === document.activeElement || el.contains(document.activeElement));
        let nextIdx = 0;
        if (activeIdx === -1) {
          nextIdx = e.key === 'j' ? 0 : items.length - 1;
        } else {
          nextIdx = e.key === 'j' 
            ? Math.min(items.length - 1, activeIdx + 1)
            : Math.max(0, activeIdx - 1);
        }

        const nextEl = items[nextIdx];
        if (nextEl) {
          nextEl.focus();
          nextEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('keydown', handleListKeyDown);
    return () => window.removeEventListener('keydown', handleListKeyDown);
  }, [selectedGameId, explainGame, showProfilesModal, showSourcesModal, showDiscordModal, showSyncModal]);

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

  const handleRefreshSingleGame = useCallback(async (gameId: string) => {
    try {
      await api.refreshGame(gameId);
      loadGames(undefined, true);
      loadStatsAndDeals();
    } catch (err) {
      console.error('Failed to refresh game:', err);
    }
  }, [loadGames, loadStatsAndDeals]);

  const totalPages = Math.ceil(totalGames / (filters.limit || 50)) || 1;
  const currentPage = filters.page || 1;

  const hasActiveFilters = Boolean(
    filters.search ||
    filters.saleOnly ||
    filters.majorDealsOnly ||
    filters.allTimeLowOnly ||
    filters.buyOnly ||
    filters.targetReachedOnly ||
    (filters.minPrice !== undefined && filters.minPrice > 0) ||
    (filters.maxPrice !== undefined && filters.maxPrice > 0) ||
    (filters.underPrice !== undefined && filters.underPrice > 0) ||
    (filters.minDiscount !== undefined && filters.minDiscount > 0) ||
    (filters.minDealScore !== undefined && filters.minDealScore > 0) ||
    (filters.minMetacritic !== undefined && filters.minMetacritic > 0) ||
    (filters.minSteamRating !== undefined && filters.minSteamRating > 0) ||
    filters.belowTypicalSaleOnly ||
    filters.hidePricingErrors ||
    filters.hideProvisional ||
    filters.hideUnreleased ||
    filters.hideDlcs ||
    filters.includeFreeGames ||
    filters.hideFamilyShared ||
    (filters.merchantType && filters.merchantType !== 'all')
  );

  const handleResetFilters = useCallback(() => {
    updateFilters({
      search: '',
      sort: 'best_value',
      saleOnly: false,
      majorDealsOnly: false,
      allTimeLowOnly: false,
      buyOnly: false,
      targetReachedOnly: false,
      underPrice: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minDiscount: undefined,
      minDealScore: undefined,
      minMetacritic: undefined,
      minSteamRating: undefined,
      belowTypicalSaleOnly: false,
      hidePricingErrors: false,
      hideProvisional: false,
      hideUnreleased: false,
      hideDlcs: false,
      includeFreeGames: false,
      hideFamilyShared: false,
      merchantType: 'all',
      hasPricingErrors: false,
      activePill: 'all',
      page: 1,
    });
  }, [updateFilters]);

  const handleFilterATL = useCallback(() => {
    const isCurrentlyActive = Boolean(filters.allTimeLowOnly);
    updateFilters({
      buyOnly: false,
      targetReachedOnly: false,
      saleOnly: false,
      majorDealsOnly: false,
      allTimeLowOnly: !isCurrentlyActive,
      underPrice: undefined,
      maxPrice: undefined,
      minPrice: undefined,
      minDiscount: undefined,
      minDealScore: undefined,
      merchantType: 'all',
      sort: isCurrentlyActive ? 'priority' : 'near_atl',
      page: 1
    });
  }, [filters.allTimeLowOnly, updateFilters]);

  const handleFilterMajor = useCallback(() => {
    const isCurrentlyActive = Boolean(filters.majorDealsOnly);
    updateFilters({
      buyOnly: false,
      targetReachedOnly: false,
      saleOnly: false,
      majorDealsOnly: !isCurrentlyActive,
      allTimeLowOnly: false,
      underPrice: undefined,
      maxPrice: undefined,
      minPrice: undefined,
      minDiscount: undefined,
      minDealScore: undefined,
      merchantType: 'all',
      sort: isCurrentlyActive ? 'priority' : 'best_value',
      page: 1
    });
  }, [filters.majorDealsOnly, updateFilters]);

  const handleFilterSale = useCallback(() => {
    const isCurrentlyActive = Boolean(filters.saleOnly);
    updateFilters({
      buyOnly: false,
      targetReachedOnly: false,
      saleOnly: !isCurrentlyActive,
      majorDealsOnly: false,
      allTimeLowOnly: false,
      underPrice: undefined,
      maxPrice: undefined,
      minPrice: undefined,
      minDiscount: undefined,
      minDealScore: undefined,
      merchantType: 'all',
      sort: isCurrentlyActive ? 'priority' : 'price_drops',
      page: 1
    });
  }, [filters.saleOnly, updateFilters]);

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <Navbar
        activeProfile={activeProfile}
        syncProgress={syncProgress}
        onOpenProfiles={handleOpenProfiles}
        onOpenSources={handleOpenSources}
        onOpenDiscord={handleOpenDiscord}
        onTriggerSync={handleOpenSync}
        onLogoClick={handleLogoClick}
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
            onClick={handleOpenProfiles}
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

            <button
              className={`main-tab-btn ${mainTab === 'savings' ? 'active' : ''}`}
              onClick={() => setMainTab('savings')}
            >
              <PiggyBank size={16} color="#34d399" />
              <span>Savings Tracker</span>
            </button>
          </div>

          {/* TAB 1: PAID WISHLIST VIEW */}
          {mainTab === 'wishlist' && (
            <>
              <DealsDashboard
                stats={stats}
                topDeals={topDeals}
                filters={filters}
                onSelectGame={handleSelectGame}
                onFilterATL={handleFilterATL}
                onFilterMajor={handleFilterMajor}
                onFilterSale={handleFilterSale}
              />

              <FilterBar
                filters={filters}
                totalGames={totalGames}
                onFilterChange={updateFilters}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
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
                    <GameCardSkeleton count={filters.limit || 24} />
                  </div>
                ) : (
                  <CompactListSkeleton rows={12} />
                )
              ) : !loading && games.length === 0 ? (
                <div className="empty-state" style={{ padding: '60px 20px' }}>
                  <Gamepad2 size={44} color="var(--text-muted)" style={{ opacity: 0.6 }} />
                  <h3 className="empty-title">
                    {hasActiveFilters ? 'No games match your filters' : 'No games found'}
                  </h3>
                  <p className="empty-desc" style={{ maxWidth: 440 }}>
                    {totalGames === 0 && !hasActiveFilters
                      ? 'Your wishlist is currently empty. Click "Sync Wishlist" to fetch your Steam wishlist and track discounts.'
                      : filters.search
                      ? `No wishlist games match "${filters.search}". Try adjusting your query or resetting filters.`
                      : 'No games match the active filter criteria. Try resetting your filters to see your full wishlist.'}
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                    {hasActiveFilters && filters.search && (
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => updateFilters({ search: '', page: 1 })}
                      >
                        <span>Clear Search</span>
                      </button>
                    )}
                    {hasActiveFilters && (
                      <button 
                        className="btn btn-outline" 
                        onClick={handleResetFilters}
                      >
                        <span>Reset All Filters</span>
                      </button>
                    )}
                    {totalGames === 0 && !hasActiveFilters && (
                      <button className="btn btn-primary" onClick={() => setShowSyncModal(true)}>
                        <RefreshCw size={16} />
                        <span>Sync Wishlist Now</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ opacity: loading ? 0.7 : 1, transition: 'opacity 0.15s ease' }}>
                  {viewMode === 'grid' ? (
                    <div className="games-grid">
                      {games.map(game => (
                        <GameCard
                          key={game.id}
                          game={game}
                          onSelect={handleSelectGame}
                          onExplain={handleExplainGame}
                        />
                      ))}
                    </div>
                  ) : (
                    <CompactListView
                      games={games}
                      onGameClick={handleGameClick}
                      onExplain={handleExplainGame}
                      onRefreshGame={handleRefreshSingleGame}
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
            <Suspense fallback={<DenseTableSkeleton rows={8} />}>
              <FreeGamesView
                games={freeGames}
                onGameClick={handleGameClick}
              />
            </Suspense>
          )}

          {/* TAB 3: TOP BEST DEALS SHOWCASE */}
          {mainTab === 'deals' && (
            <div className="best-deals-tab-view">
              <div className="deals-header" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Flame size={20} color="#f59e0b" />
                    <span>Top Ranked Deals (Best Value)</span>
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                    Ranked by verified Deal Score algorithms for maximum savings.
                  </p>
                </div>

                <ViewModeToggle viewMode={viewMode} onViewModeChange={handleViewModeChange} />
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
                      onSelect={handleSelectGame}
                      onExplain={handleExplainGame}
                    />
                  ))}
                </div>
              ) : (
                <CompactListView
                  games={topDeals}
                  onGameClick={handleGameClick}
                  onExplain={handleExplainGame}
                  onRefreshGame={handleRefreshSingleGame}
                />
              )}
            </div>
          )}

          {/* TAB 4: DATA SAFETY (ANOMALIES) VIEW */}
          {mainTab === 'safety' && (
            <Suspense fallback={<div className="loading-state"><RefreshCw className="spin" size={24} /><p>Loading Data Safety...</p></div>}>
              <AnomaliesView
                onSelectGame={(id) => setSelectedGameId(id)}
                onRefresh={() => {
                  loadAnomalies();
                  loadGames();
                  loadFreeGames();
                  loadStatsAndDeals();
                }}
              />
            </Suspense>
          )}

          {/* TAB 5: SAVINGS TRACKER (PURCHASE JOURNAL) */}
          {mainTab === 'savings' && (
            <Suspense fallback={<SavingsSkeleton />}>
              <SavingsView
                profileId={activeProfile?.id}
                onSelectGame={(id) => setSelectedGameId(id)}
              />
            </Suspense>
          )}
        </>
      )}

      {/* Modals */}
      <Suspense fallback={null}>
        {selectedGameId && (
          <GameDetailModal
            gameId={selectedGameId}
            onClose={handleCloseDetailModal}
            onTargetPriceUpdated={handleTargetPriceUpdated}
            onGameUpdated={handleGameUpdated}
            onNavigateGame={handleNavigateGame}
            hasPrev={hasPrevGame}
            hasNext={hasNextGame}
          />
        )}

        {explainGame && (
          <ScoreExplainModal
            game={explainGame}
            onClose={handleCloseExplainModal}
          />
        )}

        {showProfilesModal && (
          <ProfileModal
            profiles={profiles}
            activeProfile={activeProfile}
            onClose={handleCloseProfilesModal}
            onRefresh={handleProfileRefresh}
          />
        )}

        {showSourcesModal && (
          <SourcesModal onClose={handleCloseSourcesModal} />
        )}

        {showSyncModal && (
          <SyncModal
            onClose={handleCloseSyncModal}
            onStartSync={handleExecuteSync}
            isSyncing={syncProgress?.status === 'RUNNING'}
          />
        )}

        {showDiscordModal && (
          <DiscordModal
            isOpen={showDiscordModal}
            onClose={handleCloseDiscordModal}
          />
        )}
      </Suspense>

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
