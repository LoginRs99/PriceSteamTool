import React, { useEffect, useState, useCallback } from 'react';
import type { 
  Profile, 
  Game, 
  WishlistFilterOptions, 
  WishlistStatistics, 
  SyncProgressUpdate, 
  Anomaly, 
  SourceCode,
  ViewMode,
  MainTab
} from './types.js';
import { api } from './api.js';
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
import { AnomaliesModal } from './components/AnomaliesModal.js';
import { SyncModal } from './components/SyncModal.js';
import { DiscordModal } from './components/DiscordModal.js';
import { ScoreExplainModal } from './components/ScoreExplainModal.js';
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
  Table as TableIcon 
} from 'lucide-react';

export const App: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  
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

  const [games, setGames] = useState<Game[]>([]);
  const [totalGames, setTotalGames] = useState(0);
  const [freeGames, setFreeGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Stats and Best Deals
  const [stats, setStats] = useState<WishlistStatistics | null>(null);
  const [topDeals, setTopDeals] = useState<Game[]>([]);

  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  // Modals
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [explainGame, setExplainGame] = useState<Game | null>(null);
  const [showProfilesModal, setShowProfilesModal] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [showAnomaliesModal, setShowAnomaliesModal] = useState(false);
  const [showDiscordModal, setShowDiscordModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Filters for Paid Wishlist with localStorage persistence for sort and limit
  const [filters, setFilters] = useState<WishlistFilterOptions>(() => {
    const savedSort = localStorage.getItem('pricetool_sort') as any;
    const savedLimit = parseInt(localStorage.getItem('pricetool_limit') || '50', 10);
    return {
      sort: savedSort || 'best_value',
      page: 1,
      limit: !isNaN(savedLimit) && savedLimit > 0 ? savedLimit : 50,
      isFreeOnly: false
    };
  });

  // Track window scroll for scroll-to-top button
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

  // Load profiles
  const loadProfiles = useCallback(async () => {
    try {
      const list = await api.getProfiles();
      setProfiles(list);
      const active = list.find(p => p.isActive) || (list.length > 0 ? list[0] : null);
      setActiveProfile(active);
      return active;
    } catch (e) {
      console.error('Failed to load profiles:', e);
      return null;
    }
  }, []);

  // Load stats and top deals
  const loadStatsAndDeals = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        api.getWishlistStatistics(),
        api.getBestDeals(12)
      ]);
      setStats(s);
      setTopDeals(d.deals || []);
    } catch (e) {
      console.error('Failed to load statistics or best deals:', e);
    }
  }, []);

  // Load wishlist games
  const loadGames = useCallback(async (opts: WishlistFilterOptions = filters) => {
    setLoading(true);
    try {
      const res = await api.getWishlistGames({ ...opts, isFreeOnly: false });
      setGames(res.games);
      setTotalGames(res.total);
      if (res.activeProfile) {
        setActiveProfile(res.activeProfile);
      }
    } catch (e) {
      console.error('Failed to load wishlist games:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Load free games
  const loadFreeGames = useCallback(async () => {
    try {
      const res = await api.getWishlistGames({ isFreeOnly: true, limit: 500 });
      setFreeGames(res.games);
    } catch (e) {
      console.error('Failed to load free games:', e);
    }
  }, []);

  // Load anomalies
  const loadAnomalies = useCallback(async () => {
    try {
      const list = await api.getAnomalies();
      setAnomalies(list);
    } catch (e) {
      console.error('Failed to load anomalies:', e);
    }
  }, []);

  // Initial load & SSE connection
  useEffect(() => {
    loadProfiles().then((active) => {
      if (active) {
        loadGames();
        loadFreeGames();
        loadStatsAndDeals();
      } else {
        setLoading(false);
      }
    });

    loadAnomalies();

    // Server-Sent Events (SSE) Stream for real-time progress
    const eventSource = new EventSource('/api/sync/events');
    eventSource.onmessage = (event) => {
      try {
        const update: SyncProgressUpdate = JSON.parse(event.data);
        setSyncProgress(update);

        if (update.status === 'COMPLETED') {
          loadGames();
          loadFreeGames();
          loadStatsAndDeals();
          loadAnomalies();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [loadProfiles, loadGames, loadFreeGames, loadStatsAndDeals, loadAnomalies]);

  const handleFilterChange = (newFilters: Partial<WishlistFilterOptions>) => {
    const updated = { ...filters, ...newFilters };
    if (newFilters.sort) {
      localStorage.setItem('pricetool_sort', newFilters.sort);
    }
    if (newFilters.limit) {
      localStorage.setItem('pricetool_limit', String(newFilters.limit));
    }
    setFilters(updated);
    loadGames(updated);
  };

  const handleTriggerSync = () => {
    setShowSyncModal(true);
  };

  const handleExecuteSync = async (forceRefresh: boolean, selectedSources?: SourceCode[]) => {
    try {
      await api.startSync({ forceRefresh, sources: selectedSources });
    } catch (err: any) {
      alert(err.message || 'Failed to start sync');
    }
  };

  const handleCancelSync = async () => {
    await api.cancelSync();
  };

  const totalPages = Math.ceil(totalGames / (filters.limit || 50)) || 1;
  const currentPage = filters.page || 1;

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <Navbar
        activeProfile={activeProfile}
        syncProgress={syncProgress}
        anomalyCount={anomalies.length}
        onOpenProfiles={() => setShowProfilesModal(true)}
        onOpenSources={() => setShowSourcesModal(true)}
        onOpenAnomalies={() => setShowAnomaliesModal(true)}
        onOpenDiscord={() => setShowDiscordModal(true)}
        onTriggerSync={handleTriggerSync}
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
          </div>

          {/* TAB 1: PAID WISHLIST VIEW */}
          {mainTab === 'wishlist' && (
            <>
              <DealsDashboard
                stats={stats}
                topDeals={topDeals}
                onSelectGame={(id) => setSelectedGameId(id)}
                onFilterATL={() => handleFilterChange({ allTimeLowOnly: true, majorDealsOnly: false, saleOnly: false, page: 1 })}
                onFilterMajor={() => handleFilterChange({ majorDealsOnly: true, allTimeLowOnly: false, saleOnly: false, page: 1 })}
                onFilterSale={() => handleFilterChange({ saleOnly: true, majorDealsOnly: false, allTimeLowOnly: false, page: 1 })}
              />

              <FilterBar
                filters={filters}
                totalGames={totalGames}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                onFilterChange={handleFilterChange}
              />

              {loading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                  <p>Loading wishlist games...</p>
                </div>
              ) : games.length === 0 ? (
                <div className="empty-state">
                  <Gamepad2 size={40} color="var(--text-muted)" />
                  <h3 className="empty-title">No games found</h3>
                  <p className="empty-desc">
                    {totalGames === 0 
                      ? 'Your wishlist is currently empty. Click "Sync Wishlist" to fetch your Steam wishlist.'
                      : 'No games match your current search and filter settings.'}
                  </p>
                  {totalGames === 0 && (
                    <button className="btn btn-primary" onClick={handleTriggerSync}>
                      <span>Sync Wishlist Now</span>
                    </button>
                  )}
                </div>
              ) : (
                <>
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
                    />
                  )}

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="pagination">
                      {totalPages > 2 && (
                        <button
                          className="btn btn-secondary"
                          disabled={currentPage <= 1}
                          onClick={() => handleFilterChange({ page: 1 })}
                          title="First Page"
                          aria-label="First Page"
                        >
                          <ChevronsLeft size={16} />
                        </button>
                      )}

                      <button
                        className="btn btn-secondary"
                        disabled={currentPage <= 1}
                        onClick={() => handleFilterChange({ page: currentPage - 1 })}
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
                        onClick={() => handleFilterChange({ page: currentPage + 1 })}
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
                          onClick={() => handleFilterChange({ page: totalPages })}
                          title="Last Page"
                          aria-label="Last Page"
                        >
                          <ChevronsRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </>
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
                    Ranked by balanced Deal Score and Data Confidence for high-quality, verified savings.
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
        </>
      )}

      {/* Modals */}
      {selectedGameId && (
        <GameDetailModal
          gameId={selectedGameId}
          onClose={() => setSelectedGameId(null)}
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

      {showAnomaliesModal && (
        <AnomaliesModal
          onClose={() => setShowAnomaliesModal(false)}
          onRefresh={() => {
            loadAnomalies();
            loadGames();
            loadFreeGames();
            loadStatsAndDeals();
          }}
        />
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
