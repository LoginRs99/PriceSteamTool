import React, { useState } from 'react';
import type { Profile } from '../types.js';
import { api } from '../api.js';
import { X, UserPlus, Check, Trash2 } from 'lucide-react';

interface ProfileModalProps {
  profiles: Profile[];
  activeProfile: Profile | null;
  onClose: () => void;
  onRefresh: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profiles,
  activeProfile,
  onClose,
  onRefresh,
}) => {
  const [name, setName] = useState('');
  const [steamId, setSteamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !steamId.trim()) return;

    setError(null);
    setLoading(true);
    try {
      await api.createProfile(name.trim(), steamId.trim());
      setName('');
      setSteamId('');
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to add profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSetActive = async (id: string) => {
    await api.setActiveProfile(id);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this Steam profile and its cached wishlist entries?')) {
      await api.deleteProfile(id);
      onRefresh();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <h2 id="profile-modal-title" style={{ fontSize: 18, fontWeight: 800 }}>Steam Profiles</h2>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Profile List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profiles.map(p => {
              const isActive = p.id === activeProfile?.id;
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: isActive ? 'var(--down-dim)' : 'var(--surface)',
                    border: `1px solid ${isActive ? 'var(--down)' : 'var(--line)'}`
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.name}
                      {isActive && (
                        <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--down)', color: '#0a0b0e', borderRadius: 'var(--radius-sm)', fontWeight: 800 }}>
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
                      SteamID: {p.steamId} • {p.gameCount || 0} games
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {!isActive && (
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => handleSetActive(p.id)}
                      >
                        <Check size={14} />
                        <span>Select</span>
                      </button>
                    )}
                    <button 
                      className="btn btn-outline" 
                      style={{ padding: 6, color: 'var(--up)' }}
                      onClick={() => handleDelete(p.id)}
                      title="Delete profile"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Profile Form */}
          <form onSubmit={handleCreate} style={{ marginTop: 10, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={16} /> Add Steam Account
            </h4>

            {error && (
              <div style={{ padding: '8px 12px', background: 'var(--up-dim)', border: '1px solid var(--up)', borderRadius: 6, color: 'var(--up)', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                className="search-input"
                style={{ padding: '9px 12px' }}
                placeholder="Profile Name (e.g. My Steam Wishlist)"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />

              <input
                type="text"
                className="search-input"
                style={{ padding: '9px 12px' }}
                placeholder="Steam64 ID or Profile URL (e.g. 76561198012345678 or https://steamcommunity.com/id/myname)"
                value={steamId}
                onChange={e => setSteamId(e.target.value)}
                required
              />

              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={loading || !name.trim() || !steamId.trim()}
                style={{ marginTop: 6 }}
              >
                <span>{loading ? 'Adding...' : 'Save Steam Profile'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
