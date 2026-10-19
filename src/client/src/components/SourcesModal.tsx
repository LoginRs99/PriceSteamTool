import React, { useEffect, useState, useRef } from 'react';
import type { SourceStatus, SourceCode } from '../types.js';
import { api } from '../api.js';
import { X, Activity, AlertTriangle, RefreshCw, RotateCcw, FileText } from 'lucide-react';

interface SourcesModalProps {
  onClose: () => void;
}

const STATE_DESCRIPTIONS: Record<string, string> = {
  NORMAL: 'Healthy – standard operation and polite pacing',
  BACKOFF: 'Backoff – temporarily throttled due to upstream rate limits',
  PAUSED: 'Paused – circuit breaker opened to protect your IP from bans',
  COOLDOWN: 'Cooldown – probing adapter recovery with test requests'
};

export const SourcesModal: React.FC<SourcesModalProps> = ({ onClose }) => {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resettingCode, setResettingCode] = useState<SourceCode | null>(null);

  const fetchSources = async (isMounted = true) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const list = await api.getSources();
      if (isMounted) {
        setSources(list);
        setLoading(false);
      }
    } catch (e) {
      if (isMounted) {
        console.error('Failed to fetch sources:', e);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    fetchSources(true);
    const interval = setInterval(() => {
      if (isMounted) fetchSources(isMounted);
    }, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleToggle = async (code: SourceCode, isEnabled: boolean) => {
    try {
      setError(null);
      await api.toggleSource(code, isEnabled);
    } catch (err: any) {
      console.error('Failed to toggle source:', err);
      setError(err.message || 'Failed to toggle source');
    } finally {
      fetchSources();
    }
  };

  const handleReset = async (code: SourceCode) => {
    try {
      setResettingCode(code);
      setError(null);
      await api.resetSource(code);
    } catch (err: any) {
      console.error('Failed to reset source:', err);
      setError(err.message || 'Failed to reset source');
    } finally {
      setResettingCode(null);
      fetchSources();
    }
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
          {error && (
            <div style={{ padding: '8px 12px', background: 'var(--up-dim)', border: '1px solid var(--up)', borderRadius: 6, color: 'var(--up)', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
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
              <FileText size={14} />
              <span>View Raw Logs</span>
            </a>
          </div>

          {loading && sources.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '32px 16px', color: 'var(--dim)', fontSize: 14 }}>
              <RefreshCw size={16} className="spin" />
              <span>Loading sources...</span>
            </div>
          ) : (
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
                          title={STATE_DESCRIPTIONS[s.state] || s.state}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-sm)',
                            background: `${stateColor}20`,
                            color: stateColor,
                            border: `1px solid ${stateColor}40`,
                            textTransform: 'uppercase',
                            cursor: 'help'
                          }}
                        >
                          {s.state}
                        </span>
                        {s.state !== 'NORMAL' && (
                          <span style={{ fontSize: 12, color: stateColor, fontWeight: 500 }}>
                            {STATE_DESCRIPTIONS[s.state]}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {s.state !== 'NORMAL' && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => handleReset(s.code)}
                            disabled={resettingCode === s.code}
                            style={{
                              fontSize: 11,
                              padding: '3px 8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              borderColor: 'var(--signal)',
                              color: 'var(--signal)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer'
                            }}
                            title="Reset circuit breaker and unpause source immediately"
                          >
                            <RotateCcw size={12} className={resettingCode === s.code ? 'spin' : ''} />
                            <span>Reset / Unpause</span>
                          </button>
                        )}

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <span style={{ color: 'var(--dim)' }}>{s.isEnabled ? 'Enabled' : 'Disabled'}</span>
                          <input
                            type="checkbox"
                            checked={s.isEnabled}
                            onChange={e => handleToggle(s.code, e.target.checked)}
                          />
                        </label>
                      </div>
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

                    {s.lastError && (s.state !== 'NORMAL' || (s.consecutiveFailures || 0) > 0 || (s.consecutiveRateLimits || 0) > 0) && (
                      <div style={{ fontSize: 11, color: 'var(--up)', marginTop: 4, wordBreak: 'break-all' }}>
                        Last note: {s.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
