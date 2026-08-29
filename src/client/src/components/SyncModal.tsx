import React, { useEffect, useState } from 'react';
import type { SourceStatus, SourceCode } from '../types.js';
import { api } from '../api.js';
import { X, RefreshCw, Play, FileText, CheckSquare, Square, Info } from 'lucide-react';

interface SyncModalProps {
  onClose: () => void;
  onStartSync: (forceRefresh: boolean, selectedSources?: SourceCode[]) => void;
  isSyncing: boolean;
}

export const SyncModal: React.FC<SyncModalProps> = ({ onClose, onStartSync, isSyncing }) => {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [selectedSources, setSelectedSources] = useState<Record<SourceCode, boolean>>({
    steam: true,
    itad: true,
    ggdeals: true,
    cheapshark: true,
    allkeyshop: true
  });
  const [forceRefresh, setForceRefresh] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    api.getSources().then(list => {
      setSources(list);
      const initial: Record<string, boolean> = {};
      list.forEach(s => {
        initial[s.code] = s.isEnabled;
      });
      setSelectedSources(initial as Record<SourceCode, boolean>);
      setLoading(false);
    }).catch(() => setLoading(false));

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleSource = (code: SourceCode) => {
    setSelectedSources(prev => ({
      ...prev,
      [code]: !prev[code]
    }));
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    sources.forEach(s => { next[s.code] = true; });
    setSelectedSources(next as Record<SourceCode, boolean>);
  };

  const selectNone = () => {
    const next: Record<string, boolean> = {};
    sources.forEach(s => { next[s.code] = false; });
    setSelectedSources(next as Record<SourceCode, boolean>);
  };

  const handleStart = () => {
    const chosen = (Object.keys(selectedSources) as SourceCode[]).filter(code => selectedSources[code]);
    onStartSync(forceRefresh, chosen);
    onClose();
  };

  const selectedCount = Object.values(selectedSources).filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sync-modal-title">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={20} color="var(--down)" />
            <h2 id="sync-modal-title" style={{ fontSize: 18, fontWeight: 800 }}>Synchronize Wishlist & Prices</h2>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Sync Mode Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--dim)' }}>
              1. Synchronization Strategy
            </label>

            <div 
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10
              }}
            >
              <div
                onClick={() => setForceRefresh(false)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: `2px solid ${!forceRefresh ? 'var(--down)' : 'var(--line)'}`,
                  background: !forceRefresh ? 'var(--down-dim)' : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: !forceRefresh ? 'var(--down)' : 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🟢 Resume / Smart Cache</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 }}>
                  Only refreshes missing items or prices older than 6h. Instantly skips already-fetched games.
                </div>
              </div>

              <div
                onClick={() => setForceRefresh(true)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: `2px solid ${forceRefresh ? 'var(--signal)' : 'var(--line)'}`,
                  background: forceRefresh ? 'var(--signal-dim)' : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: forceRefresh ? 'var(--signal)' : 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔄 Force Full Refresh</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 }}>
                  Overwrites cache and re-queries every single wishlist item from scratch.
                </div>
              </div>
            </div>
          </div>

          {/* Sources Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                2. Select Sources to Query ({selectedCount} of {sources.length})
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  className="btn btn-outline" 
                  onClick={selectAll} 
                  style={{ padding: '2px 8px', fontSize: 11 }}
                >
                  Select All
                </button>
                <button 
                  className="btn btn-outline" 
                  onClick={selectNone} 
                  style={{ padding: '2px 8px', fontSize: 11 }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {sources.map(s => {
                const isSelected = Boolean(selectedSources[s.code]);
                return (
                  <div
                    key={s.code}
                    onClick={() => toggleSource(s.code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: isSelected ? 'rgba(255, 255, 255, 0.05)' : 'var(--bg-surface-elevated)',
                      border: `1px solid ${isSelected ? 'rgba(16, 185, 129, 0.5)' : 'var(--border-subtle)'}`,
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    {isSelected ? <CheckSquare size={16} color="#10b981" /> : <Square size={16} color="var(--text-muted)" />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: 10, color: s.state === 'NORMAL' ? '#34d399' : '#f87171' }}>
                        State: {s.state}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Diagnostics and Info */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginTop: 10, 
            padding: '8px 12px', 
            background: 'rgba(255,255,255,0.02)', 
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <Info size={14} />
              <span>Safe min 2.0s pacing with jitter active</span>
            </div>

            <a
              href="/api/diagnostics/logs"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                color: '#38bdf8',
                textDecoration: 'none',
                fontWeight: 600
              }}
            >
              <FileText size={14} />
              <span>View Sync Logs (txt)</span>
            </a>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={isSyncing || selectedCount === 0}
              style={{ flex: 2 }}
            >
              <Play size={16} />
              <span>{isSyncing ? 'Syncing in Progress...' : `Start Sync (${selectedCount} ${selectedCount === 1 ? 'Source' : 'Sources'})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
