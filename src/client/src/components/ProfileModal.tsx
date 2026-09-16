import React, { useState, useRef, useEffect } from 'react';
import type { Profile } from '../types.js';
import { api } from '../api.js';
import { X, UserPlus, Check, Trash2, Users, RefreshCw } from 'lucide-react';

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
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const [name, setName] = useState('');
  const [steamId, setSteamId] = useState('');
  const [isFamilyNew, setIsFamilyNew] = useState(false);
  const [syncingProfileId, setSyncingProfileId] = useState<string | null>(null);
  const [scanningExclusions, setScanningExclusions] = useState(false);
  const [exclusions, setExclusions] = useState<Array<{ steamAppId: number; reason?: string; createdAt: string }>>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadExclusions = async () => {
    try {
      const data = await api.getFamilyExclusions();
      setExclusions(data);
    } catch {
      // Ignore initial exclusion load failures
    }
  };

  useEffect(() => {
    loadExclusions();
  }, []);

  const handleAutoDetectExclusions = async () => {
    setScanningExclusions(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await api.autoDetectFamilyExclusions();
      if (res.excludedCount > 0) {
        setStatusMsg(`Scan complete: ${res.excludedCount} game(s) excluded from Family Sharing (lacking Steam Category 62 or 3rd-party DRM).`);
      } else {
        setStatusMsg(`Scan complete: all ${res.scannedCount} family-owned games support Steam Family Sharing.`);
      }
      await loadExclusions();
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to auto-detect unshareable games');
    } finally {
      setScanningExclusions(false);
    }
  };

  const handleRestoreExclusion = async (steamAppId: number) => {
    setError(null);
    try {
      await api.includeFamilyGame(steamAppId);
      setStatusMsg(`Restored Steam AppID ${steamAppId} to Family Sharing.`);
      await loadExclusions();
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to restore game to family sharing');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !steamId.trim()) return;

    setError(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      const created = isFamilyNew
        ? await api.createProfile(name.trim(), steamId.trim(), undefined, true)
        : await api.createProfile(name.trim(), steamId.trim());
      if (isFamilyNew && created?.id) {
        try {
          await api.syncFamilyLibrary(created.id);
        } catch {
          // Sync warning is non-fatal
        }
      }
      setName('');
      setSteamId('');
      setIsFamilyNew(false);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to add profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      setError(null);
      await api.setActiveProfile(id);
      onRefresh();
    } catch (err: any) {
      console.error('Failed to set active profile:', err);
      setError(err.message || 'Failed to set active profile');
    }
  };

  const handleToggleFamily = async (id: string, currentStatus: boolean) => {
    setError(null);
    setStatusMsg(null);
    try {
      await api.toggleFamilyProfile(id, !currentStatus);
      if (!currentStatus) {
        // Automatically trigger sync when toggling ON
        handleSyncFamily(id);
      } else {
        onRefresh();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle family status');
    }
  };

  const handleSyncFamily = async (id: string) => {
    setSyncingProfileId(id);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await api.syncFamilyLibrary(id);
      setStatusMsg(`Successfully synced ${res.gameCount} owned games for Steam Family sharing.`);
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to sync family library');
    } finally {
      setSyncingProfileId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this Steam profile and its cached wishlist entries?')) {
      try {
        setError(null);
        await api.deleteProfile(id);
        onRefresh();
      } catch (err: any) {
        console.error('Failed to delete profile:', err);
        setError(err.message || 'Failed to delete profile');
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h2 id="profile-modal-title" style={{ fontSize: 18, fontWeight: 800 }}>Steam Profiles</h2>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {statusMsg && (
            <div style={{ padding: '8px 12px', background: 'var(--down-dim)', border: '1px solid var(--down)', borderRadius: 6, color: 'var(--down)', fontSize: 13, marginBottom: 12 }}>
              {statusMsg}
            </div>
          )}

          {error && (
            <div style={{ padding: '8px 12px', background: 'var(--up-dim)', border: '1px solid var(--up)', borderRadius: 6, color: 'var(--up)', fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

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
                      {p.isFamily && (
                        <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: 'var(--radius-sm)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          👨‍👩‍👧 FAMILY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
                      SteamID: {p.steamId} • {p.gameCount || 0} wishlist items
                      {p.isFamily && (
                        <span> • <strong style={{ color: '#93c5fd' }}>{p.familyGamesCount || 0}</strong> family games</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.isFamily && (
                      <button
                        className="btn btn-outline"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => handleSyncFamily(p.id)}
                        disabled={syncingProfileId === p.id}
                        title="Sync owned games for Family Library sharing"
                      >
                        <RefreshCw size={12} className={syncingProfileId === p.id ? 'animate-spin' : ''} />
                        <span>{syncingProfileId === p.id ? 'Syncing...' : 'Sync Games'}</span>
                      </button>
                    )}
                    <button
                      className="btn btn-outline"
                      style={{ 
                        padding: '6px 10px', 
                        fontSize: 12,
                        color: p.isFamily ? '#60a5fa' : 'var(--text-muted)',
                        borderColor: p.isFamily ? 'rgba(59, 130, 246, 0.4)' : undefined
                      }}
                      onClick={() => handleToggleFamily(p.id, Boolean(p.isFamily))}
                      title={p.isFamily ? "Remove Family Library sharing role" : "Mark as Family Member / Partner"}
                    >
                      <Users size={12} />
                      <span>{p.isFamily ? 'Family' : '+ Family'}</span>
                    </button>
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

          {/* Family Sharing Compatibility & Exclusions */}
          {profiles.some(p => p.isFamily) && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users size={15} color="#60a5fa" /> Family Sharing Restrictions ({exclusions.length} excluded)
                  </h4>
                  <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
                    Some publisher games (EA, Ubisoft, Rockstar) are excluded by Steam from Family Sharing.
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '5px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  onClick={handleAutoDetectExclusions}
                  disabled={scanningExclusions}
                  title="Check Steam storefront for games lacking Family Sharing Category 62"
                >
                  <RefreshCw size={12} className={scanningExclusions ? 'animate-spin' : ''} />
                  <span>{scanningExclusions ? 'Scanning...' : 'Auto-Detect Unshareable Games'}</span>
                </button>
              </div>

              {exclusions.length > 0 && (
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, padding: 8, background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)' }}>
                  {exclusions.map(ex => (
                    <div key={ex.steamAppId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        <strong>AppID {ex.steamAppId}</strong> {ex.reason ? `· ${ex.reason}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '2px 8px', height: 'auto' }}
                        onClick={() => handleRestoreExclusion(ex.steamAppId)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add Profile Form */}
          <form onSubmit={handleCreate} style={{ marginTop: 14, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={16} /> Add Steam Account
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                className="search-input"
                style={{ padding: '9px 12px' }}
                placeholder="Profile Name (e.g. My Steam Wishlist or Partner)"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />

              <input
                type="text"
                className="search-input"
                style={{ padding: '9px 12px' }}
                placeholder="Steam64 ID or Profile URL (e.g. 76561198012345678 or https://steamcommunity.com/id/partner)"
                value={steamId}
                onChange={e => setSteamId(e.target.value)}
                required
              />

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={isFamilyNew}
                  onChange={e => setIsFamilyNew(e.target.checked)}
                />
                <span>👨‍👩‍👧 Mark as Family Member / Partner (Shares owned games to Family Library)</span>
              </label>

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
