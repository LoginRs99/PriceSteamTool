import React, { useState } from 'react';
import type { Game, ViewMode } from '../types.js';
import { Sparkles, ExternalLink, Play, Search, LayoutGrid, List, Table as TableIcon } from 'lucide-react';

interface FreeGamesViewProps {
  games: Game[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onGameClick: (game: Game) => void;
}

export const FreeGamesView: React.FC<FreeGamesViewProps> = ({
  games,
  viewMode,
  onViewModeChange,
  onGameClick
}) => {
  const [search, setSearch] = useState('');

  const filteredGames = games.filter(g => 
    !search.trim() || g.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="free-games-view">
      {/* Top Banner */}
      <div className="free-games-banner">
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} color="#10b981" />
            <span>Free-to-Play & Free Wishlist Titles</span>
            <span className="free-count-pill">{games.length} games</span>
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Free games are separated from the paid deal catalog so you can quickly launch or check out free titles without cluttering price analysis.
          </p>
        </div>

        {/* View Switcher & Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="search-box" style={{ maxWidth: 260 }}>
            <Search size={16} className="search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search free games..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
              aria-label="Search free games by title"
            />
          </div>

          <div className="view-mode-group" role="group" aria-label="View Mode">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => onViewModeChange('grid')}
              title="Grid View"
              aria-label="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => onViewModeChange('list')}
              title="Compact List View"
              aria-label="Compact List View"
            >
              <List size={16} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => onViewModeChange('table')}
              title="Dense Table View"
              aria-label="Dense Table View"
            >
              <TableIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content Rendering */}
      {filteredGames.length === 0 ? (
        <div className="empty-state" style={{ padding: 40, marginTop: 20 }}>
          <Sparkles size={32} color="#10b981" />
          <h3 className="empty-title">No Free Games Found</h3>
          <p className="empty-desc">
            {search ? `No free wishlist titles match "${search}".` : 'Your synced wishlist currently contains no free-to-play titles.'}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <div className="dense-table-wrapper" style={{ marginTop: 16 }}>
          <table className="dense-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Title</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 140 }}>Steam Store</th>
                <th style={{ width: 140, textAlign: 'right' }}>Play</th>
              </tr>
            </thead>
            <tbody>
              {filteredGames.map(game => (
                <tr key={game.id} className="dense-table-row" onClick={() => onGameClick(game)}>
                  <td className="cell-priority">#{game.priority ?? '—'}</td>
                  <td className="cell-title">
                    <span className="table-game-title">{game.title}</span>
                  </td>
                  <td>
                    <span className="free-badge-sm">FREE TO PLAY</span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <a
                      href={`https://store.steampowered.com/app/${game.steamAppId}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-xs"
                      style={{ gap: 4 }}
                    >
                      <span>Store</span>
                      <ExternalLink size={11} />
                    </a>
                  </td>
                  <td className="cell-action" onClick={e => e.stopPropagation()}>
                    <a
                      href={`steam://run/${game.steamAppId}`}
                      className="btn btn-primary btn-xs"
                      style={{ gap: 4 }}
                    >
                      <Play size={11} />
                      <span>Launch</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : viewMode === 'list' ? (
        <div className="compact-list-container" style={{ marginTop: 16 }}>
          {filteredGames.map(game => {
            const imageUrl = game.capsuleImage || 
              game.headerImage || 
              `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/capsule_231x87.jpg`;

            return (
              <div 
                key={game.id} 
                className="compact-row"
                onClick={() => onGameClick(game)}
              >
                <div className="compact-left">
                  {game.priority !== undefined && (
                    <span className="compact-priority">#{game.priority}</span>
                  )}
                  <img 
                    src={imageUrl} 
                    alt={game.title} 
                    className="compact-thumb"
                    loading="lazy"
                  />
                  <div className="compact-title-wrap">
                    <span className="compact-title">{game.title}</span>
                    <div className="compact-tags">
                      <span className="tag-pill tag-free">Free to Play</span>
                    </div>
                  </div>
                </div>

                <div className="compact-right" onClick={e => e.stopPropagation()}>
                  <a
                    href={`https://store.steampowered.com/app/${game.steamAppId}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-sm"
                  >
                    <span>Store Page</span>
                    <ExternalLink size={12} />
                  </a>
                  <a
                    href={`steam://run/${game.steamAppId}`}
                    className="btn btn-primary btn-sm"
                  >
                    <Play size={12} />
                    <span>Play Free</span>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="games-grid" style={{ marginTop: 16 }}>
          {filteredGames.map(game => {
            const imageUrl = game.capsuleImage || 
              game.headerImage || 
              `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;

            return (
              <div key={game.id} className="game-card" onClick={() => onGameClick(game)}>
                <div className="game-card-image-wrap">
                  <img 
                    src={imageUrl} 
                    alt={game.title} 
                    className="game-card-image"
                    loading="lazy"
                  />
                  <div className="free-badge" style={{ position: 'absolute', top: 8, left: 8 }}>
                    FREE
                  </div>
                </div>

                <div className="game-card-body">
                  <h3 className="game-title" title={game.title}>{game.title}</h3>
                  <div className="game-card-footer" style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
                    <a
                      href={`https://store.steampowered.com/app/${game.steamAppId}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-outline btn-sm"
                      style={{ flex: 1 }}
                    >
                      <span>Store</span>
                      <ExternalLink size={12} />
                    </a>
                    <a
                      href={`steam://run/${game.steamAppId}`}
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1 }}
                    >
                      <Play size={12} />
                      <span>Play</span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
