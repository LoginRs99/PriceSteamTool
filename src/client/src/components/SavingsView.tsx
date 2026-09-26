import React, { useEffect, useState, useCallback } from 'react';
import type { Purchase, SavingsSummary } from '../types.js';
import { api } from '../api.js';
import { useCurrency } from '../context/CurrencyContext.js';
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
  Tag
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [purchasesList, summaryData] = await Promise.all([
        api.getPurchases(profileId),
        api.getSavingsSummary(profileId)
      ]);
      setPurchases(Array.isArray(purchasesList) ? purchasesList : []);
      setSummary(summaryData);
    } catch (err) {
      console.error('Failed to load savings data:', err);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('Biztosan törölni szeretnéd ezt a vásárlást a naplóból?')) return;
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

  if (loading && !summary) {
    return (
      <div className="loading-state" style={{ padding: '60px 0', textAlign: 'center' }}>
        <RefreshCw className="spin" size={28} />
        <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Megtakarítási napló betöltése...</p>
      </div>
    );
  }

  const totalSpent = summary?.totalSpentEur ?? 0;
  const savedVsMsrp = summary?.totalSavedVsMsrpEur ?? 0;
  const savedVsMedian = summary?.totalSavedVsMedianEur ?? 0;
  const totalCount = summary?.totalPurchases ?? 0;

  return (
    <div className="savings-view-container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 0 40px' }}>
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
                Kövesd nyomon a realizált megtakarításaidat az eredeti árhoz (MSRP) és az átlagos akciókhoz képest.
              </p>
            </div>
          </div>

          <button
            className="btn btn-secondary"
            onClick={fetchData}
            style={{ fontSize: 13, padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title="Adatok frissítése"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Frissítés</span>
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
            <span>Összes Költés</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', marginTop: 6 }}>
            {formatPrice(totalSpent)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            {totalCount} rögzített vásárlás
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
            <span>Megtakarítás (MSRP)</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#34d399', marginTop: 6 }}>
            +{formatPrice(savedVsMsrp)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            Az eredeti listaárhoz képest
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
            <span>Akciós Felülmúlás</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent-blue)', marginTop: 6 }}>
            +{formatPrice(savedVsMedian)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            A típusos akciós medián felett
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
            <span>Havi bontású megtakarítás</span>
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--dim)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>Hónap</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Vásárlások</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Költés</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Megtakarítás (MSRP)</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Megtakarítás (Medián)</th>
                </tr>
              </thead>
              <tbody>
                {summary.monthly.map(m => (
                  <tr key={m.month} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--ink)' }}>{m.month}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{m.count} db</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{formatPrice(m.spentEur)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#34d399', fontWeight: 700 }}>+{formatPrice(m.savedVsMsrpEur)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 600 }}>+{formatPrice(m.savedVsMedianEur)}</td>
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
          <span>Vásárlási Napló ({purchases.length})</span>
        </h3>

        {purchases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--dim)' }}>
            <PiggyBank size={36} color="var(--dim)" style={{ marginBottom: 10, opacity: 0.6 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Még nincs rögzített vásárlásod</div>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Nyisd meg bármelyik játék adatlapját a listában, és kattints a <strong>"Megvettem"</strong> gombra egy ajánlat mellett a naplózáshoz!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {purchases.map(p => {
              const dateStr = p.purchasedAt ? new Date(p.purchasedAt).toLocaleDateString() : 'N/A';
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
                    gap: 12
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
                        title={onSelectGame ? 'Játék adatlap megnyitása' : undefined}
                      >
                        {p.gameTitle || 'Játék'}
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
                        <span>{dateStr}</span>
                      </span>
                      {p.notes && <span>• {p.notes}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
                        {formatPrice(p.priceEur)}
                      </div>
                      {p.savingsVsMsrpEur > 0 && (
                        <div style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                          Megtakarítás: +{formatPrice(p.savingsVsMsrpEur)}
                        </div>
                      )}
                    </div>

                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(p.id)}
                      disabled={deletingId === p.id}
                      style={{ padding: '6px 10px', fontSize: 12, color: '#f87171' }}
                      title="Vásárlás törlése a naplóból"
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
