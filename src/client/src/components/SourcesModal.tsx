import React, { useEffect, useState } from 'react';
import type { SourceStatus, SourceCode } from '../types.js';
import { api } from '../api.js';
import { X, Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

interface SourcesModalProps {
  onClose: () => void;
}

export const SourcesModal: React.FC<SourcesModalProps> = ({ onClose }) => {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    try {
      const list = await api.getSources();
      setSources(list);
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch sources:', e);
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleToggle = async (code: SourceCode, isEnabled: boolean) => {
    await api.toggleSource(code, isEnabled);
    fetchSources();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sources-modal-title">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={20} color="#10b981" />
            <h2 id="sources-modal-title" style={{ fontSize: 18, fontWeight: 800 }}>Source Adapters & Diagnostics</h2>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
              Each source adapter is isolated with its own token-bucket rate limiter and 4-state Circuit Breaker.
            </p>
            <a
              href="/api/diagnostics/logs"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline"
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
            >
              <span>📋 View Raw Logs</span>
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sources.map(s => {
              const stateColor = s.state === 'NORMAL' 
                ? 'var(--down)' 
                : s.state === 'BACKOFF' 
                ? 'var(--signal)' 
                : 'var(--up)';

              return (
                <div
                  key={s.code}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</span>
                      <span 
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: `${stateColor}20`,
                          color: stateColor,
                          border: `1px solid ${stateColor}40`,
                          textTransform: 'uppercase'
                        }}
                      >
                        {s.state}
                      </span>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <span style={{ color: 'var(--dim)' }}>{s.isEnabled ? 'Enabled' : 'Disabled'}</span>
                      <input
                        type="checkbox"
                        checked={s.isEnabled}
                        onChange={e => handleToggle(s.code, e.target.checked)}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12, color: 'var(--dim)', paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                    <div>
                      <span>Requests: </span>
                      <strong className="ticker-num" style={{ color: 'var(--ink)' }}>{s.requestCount}</strong>
                    </div>
                    <div>
                      <span>Success: </span>
                      <strong className="ticker-num" style={{ color: 'var(--down)' }}>{s.successCount}</strong>
                    </div>
                    <div>
                      <span>Failures: </span>
                      <strong className="ticker-num" style={{ color: s.failureCount > 0 ? 'var(--up)' : 'var(--dim)' }}>{s.failureCount}</strong>
                    </div>
                    <div>
                      <span>Rate Limits: </span>
                      <strong className="ticker-num" style={{ color: s.rateLimitCount > 0 ? 'var(--signal)' : 'var(--dim)' }}>{s.rateLimitCount}</strong>
                    </div>
                  </div>

                  {s.lastError && (
                    <div style={{ fontSize: 11, color: 'var(--up)', marginTop: 4, wordBreak: 'break-all' }}>
                      Last note: {s.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
