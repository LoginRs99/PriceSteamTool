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
    fetchSources();
    const interval = setInterval(fetchSources, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async (code: SourceCode, isEnabled: boolean) => {
    await api.toggleSource(code, isEnabled);
    fetchSources();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={20} color="#10b981" />
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>Source Adapters & Diagnostics</h2>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }}>
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
                ? '#10b981' 
                : s.state === 'BACKOFF' 
                ? '#f59e0b' 
                : '#ef4444';

              return (
                <div
                  key={s.code}
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
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
                          borderRadius: 4,
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
                      <span style={{ color: 'var(--text-muted)' }}>{s.isEnabled ? 'Enabled' : 'Disabled'}</span>
                      <input
                        type="checkbox"
                        checked={s.isEnabled}
                        onChange={e => handleToggle(s.code, e.target.checked)}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12, color: 'var(--text-muted)', paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <span>Requests: </span>
                      <strong style={{ color: 'var(--text-primary)' }}>{s.requestCount}</strong>
                    </div>
                    <div>
                      <span>Success: </span>
                      <strong style={{ color: '#34d399' }}>{s.successCount}</strong>
                    </div>
                    <div>
                      <span>Failures: </span>
                      <strong style={{ color: s.failureCount > 0 ? '#f87171' : 'var(--text-muted)' }}>{s.failureCount}</strong>
                    </div>
                    <div>
                      <span>Rate Limits: </span>
                      <strong style={{ color: s.rateLimitCount > 0 ? '#fbbf24' : 'var(--text-muted)' }}>{s.rateLimitCount}</strong>
                    </div>
                  </div>

                  {s.lastError && (
                    <div style={{ fontSize: 11, color: '#f87171', marginTop: 4, wordBreak: 'break-all' }}>
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
