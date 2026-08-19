import React, { useEffect, useState, useMemo } from 'react';
import type { Anomaly } from '../types.js';
import { api } from '../api.js';
import { AlertTriangle, CheckCircle2, CheckCheck, Download, ExternalLink, RefreshCw, ChevronDown, ChevronUp, Layers } from 'lucide-react';

interface AnomaliesViewProps {
  onRefresh?: () => void;
}

export const AnomaliesView: React.FC<AnomaliesViewProps> = ({ onRefresh }) => {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedGames, setCollapsedGames] = useState<Record<string, boolean>>({});

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

  const handleDismissForGame = async (items: Anomaly[]) => {
    try {
      await Promise.all(items.map(item => api.dismissAnomaly(item.id)));
      await fetchAnomalies();
      if (onRefresh) {
        onRefresh();
      }
    } catch (e) {
      console.error('Failed to dismiss anomalies for game:', e);
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

  const toggleCollapse = (gameKey: string) => {
    setCollapsedGames(prev => ({
      ...prev,
      [gameKey]: !prev[gameKey]
    }));
  };

  // Group raw one-row-per-offer anomalies by game
  const groupedAnomalies = useMemo(() => {
    const map = new Map<string, {
      gameKey: string;
      gameId: string;
      gameTitle: string;
      steamAppId?: number;
      dealUrl?: string;
      highestScore: number;
      cheapestPrice?: number;
      cheapestMerchant?: string;
      topReason?: string;
      items: Anomaly[];
    }>();

    for (const a of anomalies) {
      const key = a.gameId || a.gameTitle || a.id;
      let group = map.get(key);
      if (!group) {
        group = {
          gameKey: key,
          gameId: a.gameId,
          gameTitle: a.gameTitle || 'Unknown Game',
          steamAppId: a.steamAppId,
          dealUrl: a.dealUrl,
          highestScore: a.score ?? 0,
          cheapestPrice: a.priceEur,
          cheapestMerchant: a.merchantName,
          topReason: a.reason,
          items: []
        };
        map.set(key, group);
      }
      group.items.push(a);
      if ((a.score ?? 0) > group.highestScore) {
        group.highestScore = a.score ?? 0;
        group.topReason = a.reason || group.topReason;
      }
      if (a.priceEur !== undefined && a.priceEur !== null) {
        if (group.cheapestPrice === undefined || a.priceEur < group.cheapestPrice) {
          group.cheapestPrice = a.priceEur;
          group.cheapestMerchant = a.merchantName;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.highestScore - a.highestScore);
  }, [anomalies]);

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
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Data Safety & Price Glitch Review</h2>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {groupedAnomalies.length} {groupedAnomalies.length === 1 ? 'game' : 'games'} ({anomalies.length} flagged offer {anomalies.length === 1 ? 'row' : 'rows'})
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary" 
              onClick={handleDismissAll}
              disabled={loading || dismissing || anomalies.length === 0}
              style={{ fontSize: 13, padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Dismiss all active anomalies across all games"
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
          The anomaly detector flags store offers that deviate abnormally from median market prices or historical record lows. Grouped by game below; expand each card to review or dismiss individual merchant offers.
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
      ) : groupedAnomalies.length === 0 ? (
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groupedAnomalies.map(group => {
            const isCollapsed = Boolean(collapsedGames[group.gameKey]);
            const scorePct = Math.round(group.highestScore * 100);
            const cheapestPrice = typeof group.cheapestPrice === 'number' ? `€${group.cheapestPrice.toFixed(2)}` : null;

            return (
              <div
                key={group.gameKey}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden'
                }}
              >
                {/* Game Card Header */}
                <div
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 14,
                    flexWrap: 'wrap',
                    background: 'var(--bg-surface)'
                  }}
                >
                  <div style={{ flex: '1 1 320px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {group.steamAppId ? (
                        <a
                          href={`https://store.steampowered.com/app/${group.steamAppId}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontWeight: 800,
                            fontSize: 16,
                            color: 'var(--text-primary)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6
                          }}
                        >
                          {group.gameTitle}
                          <ExternalLink size={14} style={{ opacity: 0.7 }} />
                        </a>
                      ) : (
                        <div style={{ fontWeight: 800, fontSize: 16 }}>{group.gameTitle}</div>
                      )}

                      {/* Count of flagged offers badge */}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '3px 8px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#f87171',
                          borderRadius: 'var(--radius-sm)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <Layers size={12} />
                        {group.items.length} {group.items.length === 1 ? 'flagged offer' : 'flagged offers'}
                      </span>

                      {/* Severity badge */}
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '3px 8px',
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          borderRadius: 'var(--radius-sm)'
                        }}
                      >
                        Max Severity: {scorePct}%
                      </span>
                    </div>

                    {/* Summary line */}
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                      {cheapestPrice && (
                        <span>
                          Lowest flagged: <strong style={{ color: '#f87171' }}>{cheapestPrice}</strong> ({group.cheapestMerchant || 'Store'}) •{' '}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-secondary)' }}>{group.topReason || 'Flagged price anomaly'}</span>
                    </div>
                  </div>

                  {/* Group Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                      onClick={() => handleDismissForGame(group.items)}
                      title="Dismiss all flagged offers for this game"
                    >
                      <CheckCheck size={13} color="#10b981" />
                      <span>Dismiss Game ({group.items.length})</span>
                    </button>

                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => toggleCollapse(group.gameKey)}
                    >
                      {isCollapsed ? (
                        <>
                          <ChevronDown size={14} />
                          <span>Show Offers</span>
                        </>
                      ) : (
                        <>
                          <ChevronUp size={14} />
                          <span>Hide Offers</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Individual Offers List */}
                {!isCollapsed && (
                  <div style={{
                    borderTop: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                  }}>
                    {group.items.map(a => {
                      const itemScorePct = typeof a.score === 'number' ? Math.round(a.score * 100) : 0;
                      const itemPrice = typeof a.priceEur === 'number' ? `€${a.priceEur.toFixed(2)}` : null;

                      return (
                        <div
                          key={a.id}
                          style={{
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '10px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            flexWrap: 'wrap'
                          }}
                        >
                          <div style={{ flex: '1 1 240px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{a.merchantName || 'Store'}</strong>
                              {itemPrice && (
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    padding: '2px 6px',
                                    background: 'rgba(239, 68, 68, 0.18)',
                                    color: '#f87171',
                                    borderRadius: 'var(--radius-sm)'
                                  }}
                                >
                                  {itemPrice}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Severity: {itemScorePct}%
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>
                              {a.reason || 'Flagged price anomaly'}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {a.dealUrl && (
                              <a
                                href={a.dealUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary"
                                style={{ padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <ExternalLink size={12} />
                                View Deal
                              </a>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12 }}
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
          })}
        </div>
      )}
    </div>
  );
};
