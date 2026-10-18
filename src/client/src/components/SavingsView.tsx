import React, { useEffect, useState, useCallback } from 'react';
import type { Purchase, SavingsSummary } from '../types.js';
import { api } from '../api.js';
import { useCurrency } from '../context/CurrencyContext.js';
import { SavingsSkeleton } from './skeletons/index.js';
import { 
  PiggyBank, 
  TrendingUp, 
  ShoppingBag, 
  Trash2, 
  Calendar, 
  Store, 
  ExternalLink,
  RefreshCw,
  Sparkles,
  AlertTriangle
} from 'lucide-react';

interface SavingsViewProps {
  profileId?: string;
  onSelectGame?: (gameId: string) => void;
}

export const SavingsView: React.FC<SavingsViewProps> = ({ profileId, onSelectGame }) => {
  const { formatPrice } = useCurrency();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [summary, setSummary] = useState<SavingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [purchasesList, summaryData] = await Promise.all([
        api.getPurchases(profileId),
        api.getSavingsSummary(profileId)
      ]);
      setPurchases(Array.isArray(purchasesList) ? purchasesList : []);
      setSummary(summaryData);
    } catch (err: any) {
      console.error('Failed to load savings data:', err);
      setError(err?.message || 'Failed to load savings records. Please check backend connection.');
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this purchase from the log?')) return;
    try {
      setDeletingId(id);
      await api.deletePurchase(id);
      await fetchData();
    } catch (err) {
      console.error('Failed to delete purchase:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Zero-layout shift skeleton on initial load
  if (loading && !summary && !error) {
    return <SavingsSkeleton />;
  }

  // Explicit error state if initial load failed
  if (error && !summary) {
    return (
      <div className="savings-view-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 0 40px' }}>
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px 24px',
          textAlign: 'center',
          maxWidth: 540,
          margin: '40px auto'
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16
          }}>
            <AlertTriangle size={24} color="#ef4444" />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--ink)' }}>
            Unable to Load Savings Journal
          </h3>
          <p style={{ fontSize: 13, color: 'var(--dim)', margin: '0 0 20px', lineHeight: 1.5 }}>
            {error}
          </p>
          <button
            className="btn btn-primary"
            onClick={fetchData}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 18px' }}
          >
            <RefreshCw size={15} />
            <span>Retry Connection</span>
          </button>
        </div>
      </div>
    );
  }

  const totalSpent = summary?.totalSpentEur ?? 0;
  const savedVsMsrp = summary?.totalSavedVsMsrpEur ?? 0;
  const savedVsMedian = summary?.totalSavedVsMedianEur ?? 0;
  const totalCount = summary?.totalPurchases ?? 0;

  return (
    <div className="savings-view-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 0 40px' }}>
      {/* Background refresh error banner */}
      {error && summary && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          marginBottom: 16,
          color: '#f87171',
          fontSize: 13
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={15} />
            <span>Failed to refresh savings data: {error}</span>
          </div>
          <button
            className="btn btn-secondary"
            onClick={fetchData}
            style={{ fontSize: 12, padding: '4px 10px', height: 'auto' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(52, 211, 153, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <PiggyBank size={26} color="#34d399" />
            </div>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>
                Purchase Journal & Savings Tracker
              </h2>
              <p style={{ fontSize: 13, color: 'var(--dim)', margin: '3px 0 0' }}>
                Track your realized savings compared to original price (MSRP) and typical sale prices.
              </p>
            </div>
          </div>

          <button
            className="btn btn-secondary"
            onClick={fetchData}
            disabled={loading}
            style={{ fontSize: 13, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="Refresh data"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        marginBottom: 24
      }}>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px'
        }}>
          <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShoppingBag size={14} color="var(--accent-blue)" />
            <span>Total Spent</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {formatPrice(totalSpent)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {totalCount} recorded {totalCount === 1 ? 'purchase' : 'purchases'}
          </div>
        </div>

        <div style={{
          background: 'rgba(52, 211, 153, 0.08)',
          border: '1px solid rgba(52, 211, 153, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px'
        }}>
          <div style={{ fontSize: 12, color: '#34d399', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={14} color="#34d399" />
            <span>Savings (MSRP)</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            +{formatPrice(savedVsMsrp)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            vs. original list price
          </div>
        </div>

        <div style={{
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px'
        }}>
          <div style={{ fontSize: 12, color: 'var(--accent-blue)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={14} color="var(--accent-blue)" />
            <span>Sale Beat</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-blue)', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            +{formatPrice(savedVsMedian)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            Above typical sale median
          </div>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      {summary?.monthly && summary.monthly.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: 20,
          marginBottom: 24
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} color="var(--accent-blue)" />
            <span>Monthly Savings Breakdown</span>
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--dim)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>Month</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Purchases</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Spent</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Savings (MSRP)</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Savings (Median)</th>
                </tr>
              </thead>
              <tbody>
                {summary.monthly.map(m => (
                  <tr key={m.month} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink)' }}>{m.month}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{m.count}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatPrice(m.spentEur)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#34d399', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>+{formatPrice(m.savedVsMsrpEur)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>+{formatPrice(m.savedVsMedianEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Purchases List */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 20
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShoppingBag size={16} color="#34d399" />
          <span>Purchase Log ({purchases.length})</span>
        </h3>

        {purchases.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: 'var(--surface)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            margin: '8px 0'
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(52, 211, 153, 0.12)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}>
              <PiggyBank size={28} color="#34d399" />
            </div>
            <h4 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--ink)' }}>
              No purchases recorded yet
            </h4>
            <p style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.5 }}>
              Track your real-world savings against original Steam list prices (MSRP) and historical sale medians.
            </p>
            <div style={{
              display: 'inline-flex',
              flexDirection: 'column',
              gap: 8,
              textAlign: 'left',
              background: 'var(--bg-base)',
              padding: '12px 18px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
              color: 'var(--dim)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(56, 189, 248, 0.2)', color: 'var(--accent-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11 }}>1</span>
                <span>Navigate to any game in your <strong>Wishlist</strong> or <strong>Best Deals</strong>.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(56, 189, 248, 0.2)', color: 'var(--accent-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11 }}>2</span>
                <span>Open game details and find the merchant offer you purchased.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(52, 211, 153, 0.2)', color: '#34d399', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11 }}>3</span>
                <span>Click <strong>"I Bought It"</strong> to log the transaction and update your stats!</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {purchases.map(p => {
              const dateStr = p.purchasedAt ? new Date(p.purchasedAt).toLocaleDateString() : 'N/A';
              const isDeleting = deletingId === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    opacity: isDeleting ? 0.5 : 1,
                    transition: 'opacity 0.2s ease'
                  }}
                >
                  <div style={{ flex: '1 1 260px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: 'var(--ink)',
                          cursor: onSelectGame ? 'pointer' : 'default'
                        }}
                        onClick={() => onSelectGame && onSelectGame(p.gameId)}
                        title={onSelectGame ? 'Open game detail' : undefined}
                      >
                        {p.gameTitle || 'Game'}
                      </span>
                      {onSelectGame && (
                        <ExternalLink size={12} color="var(--dim)" style={{ cursor: 'pointer' }} onClick={() => onSelectGame(p.gameId)} />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, fontSize: 12, color: 'var(--dim)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Store size={12} />
                        <span>{p.merchantName || 'Bolt'}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={12} />
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{dateStr}</span>
                      </span>
                      {p.notes && <span>• {p.notes}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatPrice(p.priceEur)}
                      </div>
                      {p.savingsVsMsrpEur > 0 && (
                        <div style={{ fontSize: 11, color: '#34d399', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          Saved: +{formatPrice(p.savingsVsMsrpEur)}
                        </div>
                      )}
                    </div>

                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(p.id)}
                      disabled={isDeleting}
                      style={{ padding: '6px 10px', fontSize: 12, color: '#f87171' }}
                      title="Remove purchase from log"
                      aria-label="Remove purchase from log"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
