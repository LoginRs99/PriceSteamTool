import React, { useState } from 'react';
import type { Game } from '../types.js';
import { GameImage } from './GameImage.js';
import { Sparkles, ExternalLink, Play, Search } from 'lucide-react';

interface FreeGamesViewProps {
  games: Game[];
  onGameClick: (game: Game) => void;
}

export const FreeGamesView: React.FC<FreeGamesViewProps> = ({
  games,
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

        {/* Search */}
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
      ) : (
        <div className="dense-table-wrapper" style={{ marginTop: 16 }}>
          <table className="dense-table">
            <thead>
              <tr>
                <th className="th-priority" style={{ width: 50 }}>#</th>
                <th className="th-title">Title</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 140 }}>Steam Store</th>
                <th style={{ width: 140, textAlign: 'right' }}>Play</th>
              </tr>
            </thead>
            <tbody>
              {filteredGames.map(game => {
                return (
                  <tr key={game.id} className="dense-table-row" onClick={() => onGameClick(game)}>
                    <td className="cell-priority">#{game.priority ?? '—'}</td>
                    <td className="cell-title">
                      <div className="table-title-wrap">
                        <GameImage
                          game={game}
                          alt=""
                          className="table-capsule-img"
                          type="capsule"
                        />
                        <span className="table-game-title">{game.title}</span>
                      </div>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
