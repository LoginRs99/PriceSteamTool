import React, { useEffect, useState } from 'react';
import type { Anomaly } from '../types.js';
import { api } from '../api.js';
import { AlertTriangle, CheckCircle2, CheckCheck, Download, ExternalLink, RefreshCw } from 'lucide-react';

interface AnomaliesViewProps {
  onRefresh?: () => void;
}

export const AnomaliesView: React.FC<AnomaliesViewProps> = ({ onRefresh }) => {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnomalies = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await api.getAnomalies();
      setAnomalies(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to fetch anomalies:', e);
      setError('Failed to load anomalies. Please try again.');
      setAnomalies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnomalies();
  }, []);

  const handleDismiss = async (id: string) => {
    try {
      await api.dismissAnomaly(id);
      await fetchAnomalies();
      if (onRefresh) {
        onRefresh();
      }
    } catch (e) {
      console.error('Failed to dismiss anomaly:', e);
    }
  };

  const handleDismissAll = async () => {
    if (anomalies.length === 0) return;
    try {
      setDismissing(true);
      await api.dismissAllAnomalies();
      await fetchAnomalies();
      if (onRefresh) {
        onRefresh();
      }
    } catch (e) {
      console.error('Failed to dismiss all anomalies:', e);
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="anomalies-view-container" style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 0' }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px 28px',
        marginBottom: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={24} color="#f59e0b" />
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Data Safety & Price Glitch Review</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary" 
              onClick={handleDismissAll}
              disabled={loading || dismissing || anomalies.length === 0}
              style={{ fontSize: 13, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Dismiss all active anomalies"
            >
              <CheckCheck size={14} color="#10b981" />
              <span>Dismiss All {anomalies.length > 0 ? `(${anomalies.length})` : ''}</span>
            </button>
            <a 
              href="/api/export/offers.csv" 
              className="btn btn-secondary" 
              download="priceSteamTool-offers-export.csv"
              style={{ fontSize: 13, padding: '6px 14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Export all current offers for wishlist games to CSV"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </a>
            <button 
              className="btn btn-secondary" 
              onClick={fetchAnomalies}
              disabled={loading || dismissing}
              style={{ fontSize: 13, padding: '6px 14px' }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
          The anomaly detector flags deals that deviate abnormally from median store prices or historical lows. Anomalies remain visible so you can evaluate them manually.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <p>Loading price anomalies...</p>
        </div>
      ) : error ? (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <AlertTriangle size={36} color="#ef4444" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 }}>{error}</h3>
          <p style={{ fontSize: 13, marginBottom: 16 }}>Unable to connect to the anomaly service.</p>
          <button className="btn btn-secondary" onClick={fetchAnomalies} style={{ margin: '0 auto' }}>
            <RefreshCw size={14} />
            <span>Try Again</span>
          </button>
        </div>
      ) : anomalies.length === 0 ? (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '60px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}>
          <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 14px auto' }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)', marginBottom: 6 }}>No active price anomalies</h3>
          <p style={{ fontSize: 14, maxWidth: 500, margin: '0 auto' }}>All current merchant offers fall within standard pricing distributions.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {anomalies.map(a => {
            const scorePct = typeof a.score === 'number' ? Math.round(a.score * 100) : 0;
            const price = typeof a.priceEur === 'number' ? `€${a.priceEur.toFixed(2)}` : null;

            return (
              <div
                key={a.id}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  padding: '18px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ flex: '1 1 320px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {a.dealUrl ? (
                      <a
                        href={a.dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: 700,
                          fontSize: 16,
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        {a.gameTitle || 'Unknown Game'}
                        <ExternalLink size={14} style={{ opacity: 0.7 }} />
                      </a>
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{a.gameTitle || 'Unknown Game'}</div>
                    )}

                    {price && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          padding: '3px 8px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          borderRadius: 'var(--radius-sm)'
                        }}
                      >
                        {price}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                    Merchant: <strong style={{ color: 'var(--text-secondary)' }}>{a.merchantName || 'Store'}</strong> • Anomaly Severity: {scorePct}%
                  </div>
                  <div style={{ fontSize: 13, color: '#f87171', marginTop: 6, fontWeight: 500 }}>
                    {a.reason || 'Flagged price anomaly'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {a.dealUrl && (
                    <a
                      href={a.dealUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-primary"
                      style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <ExternalLink size={14} />
                      View Deal
                    </a>
                  )}

                  <button
                    className="btn btn-secondary"
                    style={{ padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap' }}
                    onClick={() => handleDismiss(a.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
