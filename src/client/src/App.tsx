import React, { useEffect, useState, useCallback } from 'react';
import type { 
  Profile, 
  Game, 
  WishlistFilterOptions, 
  SyncProgressUpdate,
  Anomaly 
} from './types.js';
import { api } from './api.js';
import { Navbar } from './components/Navbar.js';
import { SyncBanner } from './components/SyncBanner.js';
import { FilterBar } from './components/FilterBar.js';
import { GameCard } from './components/GameCard.js';
import { GameDetailModal } from './components/GameDetailModal.js';
import { ProfileModal } from './components/ProfileModal.js';
import { SourcesModal } from './components/SourcesModal.js';
import { AnomaliesModal } from './components/AnomaliesModal.js';
import { ChevronLeft, ChevronRight, Gamepad2, PlusCircle } from 'lucide-react';

export const App: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  
  const [games, setGames] = useState<Game[]>([]);
  const [totalGames, setTotalGames] = useState(0);
  const [loading, setLoading] = useState(true);

  const [syncProgress, setSyncProgress] = useState<SyncProgressUpdate | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  // Modals
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [showProfilesModal, setShowProfilesModal] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState(false);
  const [showAnomaliesModal, setShowAnomaliesModal] = useState(false);

  // Filters
  const [filters, setFilters] = useState<WishlistFilterOptions>({
    sort: 'priority',
    page: 1,
    limit: 48
  });

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

  // Load wishlist games
  const loadGames = useCallback(async (opts: WishlistFilterOptions = filters) => {
    setLoading(true);
    try {
      const res = await api.getWishlistGames(opts);
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

        // If sync just completed, refresh the game list & anomalies
        if (update.status === 'COMPLETED') {
          loadGames();
          loadAnomalies();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleFilterChange = (newFilters: Partial<WishlistFilterOptions>) => {
    const updated = { ...filters, ...newFilters };
    setFilters(updated);
    loadGames(updated);
  };

  const handleTriggerSync = async () => {
    try {
      await api.startSync();
    } catch (err: any) {
      alert(err.message || 'Failed to start sync');
    }
  };

  const handleCancelSync = async () => {
    await api.cancelSync();
  };

  const totalPages = Math.ceil(totalGames / (filters.limit || 48)) || 1;
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
          {/* Filters and Search Bar */}
          <FilterBar
            filters={filters}
            totalGames={totalGames}
            onFilterChange={handleFilterChange}
          />

          {/* Games Grid or Empty State */}
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
              <div className="games-grid">
                {games.map(game => (
                  <GameCard
                    key={game.id}
                    game={game}
                    onClick={() => setSelectedGameId(game.id)}
                  />
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn btn-secondary"
                    disabled={currentPage <= 1}
                    onClick={() => handleFilterChange({ page: currentPage - 1 })}
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>

                  <span className="page-info">
                    Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({totalGames} items)
                  </span>

                  <button
                    className="btn btn-secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => handleFilterChange({ page: currentPage + 1 })}
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
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

      {showProfilesModal && (
        <ProfileModal
          profiles={profiles}
          activeProfile={activeProfile}
          onClose={() => setShowProfilesModal(false)}
          onRefresh={async () => {
            await loadProfiles();
            loadGames();
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
          }}
        />
      )}
    </div>
  );
};
