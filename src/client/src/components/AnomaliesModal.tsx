import React, { useEffect, useState } from 'react';
import type { Anomaly } from '../types.js';
import { api } from '../api.js';
import { X, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';

interface AnomaliesModalProps {
  onClose: () => void;
  onRefresh: () => void;
}

export const AnomaliesModal: React.FC<AnomaliesModalProps> = ({ onClose, onRefresh }) => {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnomalies = async () => {
    try {
      const list = await api.getAnomalies();
      setAnomalies(list);
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch anomalies:', e);
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    fetchAnomalies();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDismiss = async (id: string) => {
    await api.dismissAnomaly(id);
    fetchAnomalies();
    onRefresh();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="anomalies-modal-title">
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} color="#f59e0b" />
            <h2 id="anomalies-modal-title" style={{ fontSize: 18, fontWeight: 800 }}>Price Anomalies & Glitch Review</h2>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            The anomaly detector flags deals that deviate abnormally from median store prices or historical lows. Anomalies remain visible so you can evaluate them manually.
          </p>

          {anomalies.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 10px auto' }} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>No active price anomalies</p>
              <p style={{ fontSize: 13 }}>All current merchant offers fall within standard pricing distributions.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {anomalies.map(a => (
                <div
                  key={a.id}
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 14,
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ flex: '1 1 300px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {a.dealUrl ? (
                        <a
                          href={a.dealUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            color: 'var(--text-primary)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-primary)'}
                        >
                          {a.gameTitle}
                          <ExternalLink size={13} style={{ opacity: 0.7 }} />
                        </a>
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{a.gameTitle}</div>
                      )}

                      {a.priceEur !== undefined && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            padding: '2px 7px',
                            background: 'rgba(239, 68, 68, 0.2)',
                            color: '#f87171',
                            borderRadius: 'var(--radius-sm)'
                          }}
                        >
                          €{a.priceEur.toFixed(2)}
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Merchant: <strong style={{ color: 'var(--text-secondary)' }}>{a.merchantName}</strong> • Anomaly Score: {a.score !== undefined ? `${(a.score * 100).toFixed(0)}%` : '—'}
                    </div>
                    <div style={{ fontSize: 13, color: '#f87171', marginTop: 4 }}>
                      {a.reason}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {a.dealUrl && (
                      <a
                        href={a.dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      >
                        <ExternalLink size={13} />
                        View Deal
                      </a>
                    )}

                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => handleDismiss(a.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
