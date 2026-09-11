import React, { useEffect, useState, useMemo } from 'react';
import type { PricingError as Anomaly } from '../types.js';
import { api } from '../api.js';
import { 
  AlertTriangle, 
  CheckCircle2, 
  CheckCheck, 
  Download, 
  ExternalLink, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  Layers, 
  Search, 
  Store, 
  TrendingDown, 
  SlidersHorizontal,
  Eye
} from 'lucide-react';

interface AnomaliesViewProps {
  onRefresh?: () => void;
  onSelectGame?: (gameId: string) => void;
}

export const AnomaliesView: React.FC<AnomaliesViewProps> = ({ onRefresh, onSelectGame }) => {
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

  // UI filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM'>('ALL');
  const [selectedMerchant, setSelectedMerchant] = useState<string>('ALL');

  // Distinct merchants for filter dropdown
  const merchantsList = useMemo(() => {
    const set = new Set<string>();
    for (const a of anomalies) {
      if (a.merchantName) set.add(a.merchantName);
    }
    return Array.from(set).sort();
  }, [anomalies]);

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
          highestScore: a.confidence ?? 0,
          cheapestPrice: a.priceEur,
          cheapestMerchant: a.merchantName,
          topReason: a.reason,
          items: []
        };
        map.set(key, group);
      }
      group.items.push(a);
      if ((a.confidence ?? 0) > group.highestScore) {
        group.highestScore = a.confidence ?? 0;
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

  // Filtered groups based on search & filter controls
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return groupedAnomalies.filter(group => {
      // 1. Text search by game title or merchant name
      if (q) {
        const matchesTitle = group.gameTitle.toLowerCase().includes(q);
        const matchesMerchant = group.items.some(it => (it.merchantName || '').toLowerCase().includes(q));
        if (!matchesTitle && !matchesMerchant) return false;
      }

      // 2. Severity filter
      if (severityFilter === 'HIGH' && group.highestScore < 0.60) return false;
      if (severityFilter === 'MEDIUM' && (group.highestScore < 0.35 || group.highestScore >= 0.60)) return false;

      // 3. Merchant filter
      if (selectedMerchant !== 'ALL') {
        const hasMerchant = group.items.some(it => it.merchantName === selectedMerchant);
        if (!hasMerchant) return false;
      }

      return true;
    });
  }, [groupedAnomalies, searchQuery, severityFilter, selectedMerchant]);

  // Overall statistics
  const stats = useMemo(() => {
    const totalOffers = anomalies.length;
    const totalGames = groupedAnomalies.length;
    const highRiskCount = anomalies.filter(a => (a.confidence ?? 0) >= 0.60).length;
    const subEuroGlitchCount = anomalies.filter(a => (a.priceEur !== undefined && a.priceEur < 1.00) || (a.reason && a.reason.includes('glitch'))).length;
    return { totalOffers, totalGames, highRiskCount, subEuroGlitchCount };
  }, [anomalies, groupedAnomalies]);

  return (
    <div className="anomalies-view-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 0 40px 0' }}>
      
      {/* 1. Header & Quick Actions */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(245, 158, 11, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <AlertTriangle size={24} color="#f59e0b" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>Data Safety & Price Glitch Review</h2>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 12,
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-blue)'
                }}>
                  Active in Deals
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--dim)', margin: '3px 0 0 0' }}>
                Unverified or abnormal price drops remain active in deals. Review outliers below, inspect full game offers, or dismiss verified records.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button 
              className="btn btn-secondary" 
              onClick={handleDismissAll}
              disabled={loading || dismissing || anomalies.length === 0}
              style={{ fontSize: 13, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Dismiss all active outliers from the safety review list"
            >
              <CheckCheck size={14} color="#10b981" />
              <span>Dismiss All {anomalies.length > 0 ? `(${anomalies.length})` : ''}</span>
            </button>
            <a 
              href="/api/export/offers.csv" 
              className="btn btn-secondary" 
              download="priceSteamTool-offers-export.csv"
              style={{ fontSize: 13, padding: '7px 14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Export all offers across your wishlist to CSV"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </a>
            <button 
              className="btn btn-secondary" 
              onClick={fetchAnomalies}
              disabled={loading || dismissing}
              style={{ fontSize: 13, padding: '7px 14px' }}
              title="Refresh anomaly data"
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* 2. Key Metrics Strip */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginTop: 18,
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)'
        }}>
          <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase' }}>Flagged Games</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--ink)', marginTop: 2 }}>
              {stats.totalGames}
            </div>
          </div>
          <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase' }}>Total Flagged Offers</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#fbbf24', marginTop: 2 }}>
              {stats.totalOffers}
            </div>
          </div>
          <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase' }}>High Risk Drops</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f87171', marginTop: 2 }}>
              {stats.highRiskCount}
            </div>
          </div>
          <div style={{ background: 'var(--surface)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase' }}>Sub-Euro / Deep Glitches</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--accent-purple)', marginTop: 2 }}>
              {stats.subEuroGlitchCount}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Search & Filtering Toolbar */}
      {anomalies.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          {/* Search box */}
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
            <Search size={15} color="var(--dim)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input 
              type="text"
              placeholder="Search by game title or merchant..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 12px 7px 32px',
                fontSize: 13,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--ink)'
              }}
            />
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--dim)' }}>
              <SlidersHorizontal size={14} />
              <span>Severity:</span>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as any)}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--ink)'
                }}
              >
                <option value="ALL">All Severities</option>
                <option value="HIGH">High Risk (60%+)</option>
                <option value="MEDIUM">Medium Risk (35-59%)</option>
              </select>
            </div>

            {merchantsList.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--dim)' }}>
                <Store size={14} />
                <span>Store:</span>
                <select
                  value={selectedMerchant}
                  onChange={(e) => setSelectedMerchant(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--ink)'
                  }}
                >
                  <option value="ALL">All Stores ({merchantsList.length})</option>
                  {merchantsList.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Content Area */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--dim)' }}>
          <RefreshCw size={28} className="spin-icon" style={{ margin: '0 auto 12px auto' }} />
          <p style={{ margin: 0 }}>Scanning price history and outliers...</p>
        </div>
      ) : error ? (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--dim)'
        }}>
          <AlertTriangle size={36} color="#ef4444" style={{ margin: '0 auto 12px auto' }} />
          <h3 style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>{error}</h3>
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
          color: 'var(--dim)'
        }}>
          <CheckCircle2 size={42} color="#10b981" style={{ margin: '0 auto 14px auto' }} />
          <h3 style={{ fontWeight: 700, fontSize: 18, color: 'var(--ink)', marginBottom: 6 }}>All prices clean & verified</h3>
          <p style={{ fontSize: 14, maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
            No unverified price drops or deep statistical outliers are currently flagged. All active offers align smoothly with market distributions.
          </p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--dim)'
        }}>
          <Search size={32} color="var(--dim)" style={{ margin: '0 auto 12px auto', opacity: 0.6 }} />
          <h3 style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>No matches found</h3>
          <p style={{ fontSize: 13, margin: '0 auto 14px auto' }}>No flagged outliers match your current search and filter settings.</p>
          <button 
            className="btn btn-secondary" 
            onClick={() => { setSearchQuery(''); setSeverityFilter('ALL'); setSelectedMerchant('ALL'); }}
            style={{ margin: '0 auto', fontSize: 12, padding: '5px 12px' }}
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filteredGroups.map(group => {
            const isCollapsed = Boolean(collapsedGames[group.gameKey]);
            const scorePct = Math.round(group.highestScore * 100);
            const cheapestPrice = typeof group.cheapestPrice === 'number' ? `€${group.cheapestPrice.toFixed(2)}` : null;
            const isCriticalRisk = group.highestScore >= 0.60;

            return (
              <div
                key={group.gameKey}
                style={{
                  background: 'var(--bg-surface)',
                  border: isCriticalRisk ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease'
                }}
              >
                {/* Game Header Bar */}
                <div
                  style={{
                    padding: '14px 18px',
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
                      {/* Game Title (Clickable to open GameDetailModal or Steam) */}
                      {onSelectGame && group.gameId ? (
                        <button
                          type="button"
                          onClick={() => onSelectGame(group.gameId)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontWeight: 800,
                            fontSize: 16,
                            color: 'var(--ink)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6
                          }}
                          title="Open Game Details Modal"
                        >
                          <span>{group.gameTitle}</span>
                          <Eye size={14} style={{ opacity: 0.7, color: 'var(--accent-blue)' }} />
                        </button>
                      ) : group.steamAppId ? (
                        <a
                          href={`https://store.steampowered.com/app/${group.steamAppId}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontWeight: 800,
                            fontSize: 16,
                            color: 'var(--ink)',
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
                        <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--ink)' }}>{group.gameTitle}</div>
                      )}

                      {/* Flagged offers count badge */}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 7px',
                          background: 'rgba(239, 68, 68, 0.14)',
                          color: '#f87171',
                          borderRadius: 'var(--radius-sm)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <Layers size={11} />
                        {group.items.length} {group.items.length === 1 ? 'flagged offer' : 'flagged offers'}
                      </span>

                      {/* Severity badge */}
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 7px',
                          background: isCriticalRisk ? 'rgba(239, 68, 68, 0.18)' : 'rgba(245, 158, 11, 0.15)',
                          color: isCriticalRisk ? '#f87171' : '#fbbf24',
                          borderRadius: 'var(--radius-sm)'
                        }}
                      >
                        Severity: {scorePct}% {isCriticalRisk ? '(High Risk)' : '(Medium Risk)'}
                      </span>
                    </div>

                    {/* Summary line */}
                    <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {cheapestPrice && (
                        <span>
                          Cheapest outlier: <strong style={{ color: '#f87171', fontFamily: 'var(--font-mono)' }}>{cheapestPrice}</strong> ({group.cheapestMerchant || 'Store'}) •
                        </span>
                      )}
                      <span style={{ color: 'var(--text-secondary)' }}>{group.topReason || 'Flagged price outlier'}</span>
                    </div>
                  </div>

                  {/* Actions Right */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {onSelectGame && group.gameId && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        onClick={() => onSelectGame(group.gameId)}
                        title="Open full offers table and price history for this game"
                      >
                        <Eye size={13} color="var(--accent-blue)" />
                        <span>Inspect Offers</span>
                      </button>
                    )}

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
                      title={isCollapsed ? "Expand flagged store offers" : "Collapse flagged store offers"}
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
                      const itemScorePct = typeof a.confidence === 'number' ? Math.round(a.confidence * 100) : 0;
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
                              <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{a.merchantName || 'Store'}</strong>
                              {itemPrice && (
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 800,
                                    padding: '2px 6px',
                                    background: 'rgba(239, 68, 68, 0.18)',
                                    color: '#f87171',
                                    borderRadius: 'var(--radius-sm)',
                                    fontFamily: 'var(--font-mono)'
                                  }}
                                >
                                  {itemPrice}
                                </span>
                              )}
                              <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                                Risk Score: {itemScorePct}%
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--amber, #f59e0b)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <AlertTriangle size={12} />
                              <span>{a.reason || 'Flagged price outlier'}</span>
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
                                <span>Buy / View</span>
                              </a>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => handleDismiss(a.id)}
                              title="Dismiss this specific anomaly"
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
