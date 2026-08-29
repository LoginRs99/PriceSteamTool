import React from 'react';
import type { Offer } from '../../types.js';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Copy, 
  Check 
} from 'lucide-react';

interface OffersTableProps {
  offers: Offer[];
  copiedVoucherId: string | null;
  onCopyVoucher: (offerId: string, voucherCode: string) => void;
}

export const OffersTable: React.FC<OffersTableProps> = ({
  offers,
  copiedVoucherId,
  onCopyVoucher
}) => {
  return (
    <div>
      <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
        All Available Offers ({offers.length})
      </h4>

      {offers.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No offers currently recorded for this game. Run a sync to fetch prices.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="offers-table">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Deal Score</th>
                <th>Type & Region</th>
                <th>Price (EUR / Raw)</th>
                <th>Sources</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {offers.map(offer => {
                const score = offer.dealScore ?? 0;
                const tier = offer.dealTier || 'Fair';
                const color = 
                  tier === 'Exceptional' ? '#8b5cf6' : 
                  tier === 'Great' ? '#10b981' : 
                  tier === 'Fair' ? '#3b82f6' : '#64748b';

                return (
                  <tr key={offer.id}>
                    <td>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {offer.merchantName}
                        {offer.isOfficial && (
                          <span title="Official Authorized Retailer" style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <ShieldCheck size={14} color="#10b981" />
                          </span>
                        )}
                      </div>
                      
                      {/* Evaluation Flags */}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {offer.priceEvent === 'NEW_HISTORICAL_LOW' && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', borderRadius: 3 }}>
                            🏆 ALL-TIME LOW
                          </span>
                        )}
                        {offer.priceEvent === 'EXTREME_DROP' && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', borderRadius: 3 }}>
                            🔥 MEGA DEAL
                          </span>
                        )}
                        {offer.priceEvent === 'MAJOR_DROP' && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderRadius: 3 }}>
                            ✨ MAJOR DROP
                          </span>
                        )}
                        {offer.riskLevel === 'HIGH' ? (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: 3, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <AlertTriangle size={10} /> HIGH RISK
                          </span>
                        ) : offer.riskLevel === 'MEDIUM' ? (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', borderRadius: 3 }}>
                            ⚠️ CAUTION
                          </span>
                        ) : null}
                      </div>

                      {offer.isAnomaly && (
                        <span style={{ fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                          <AlertTriangle size={11} /> {offer.anomalyReason || 'Anomaly'}
                        </span>
                      )}
                    </td>
                    <td>
                      {score > 0 ? (
                        <span 
                          style={{ 
                            fontSize: 11, 
                            fontWeight: 800, 
                            padding: '2px 8px', 
                            borderRadius: 12, 
                            background: color, 
                            color: '#fff',
                            display: 'inline-block'
                          }}
                        >
                          {score} • {tier}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {offer.productType.replace('_', ' ')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {offer.regionType}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>€{offer.priceEur.toFixed(2)}</span>
                        {offer.isFresh === false && (
                          <span 
                            className="stale-badge"
                            style={{ 
                              fontSize: 10, 
                              fontWeight: 700, 
                              padding: '1px 4px', 
                              borderRadius: 3, 
                              background: 'rgba(148, 163, 184, 0.18)', 
                              color: 'var(--text-muted)',
                              border: '1px solid rgba(148, 163, 184, 0.3)' 
                            }}
                            title="Stale fallback price (last observed >72h ago)"
                          >
                            Stale
                          </span>
                        )}
                      </div>
                      {(offer.discountPercent || 0) > 0 && (
                        <span style={{ fontSize: 11, color: '#34d399' }}>
                          -{offer.discountPercent}%
                        </span>
                      )}
                      {offer.rawCurrency && offer.rawCurrency !== 'EUR' && offer.rawPrice && (
                        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          {offer.rawPrice.toFixed(2)} {offer.rawCurrency}
                        </div>
                      )}
                      {offer.voucherCode && (
                        <div style={{ marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => onCopyVoucher(offer.id, offer.voucherCode!)}
                            className="voucher-copy-btn"
                            title="Click to copy voucher code to clipboard"
                            style={{
                              background: copiedVoucherId === offer.id ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.12)',
                              border: '1px dashed #10b981',
                              color: '#10b981',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            {copiedVoucherId === offer.id ? (
                              <>
                                <Check size={11} />
                                <span>COPIED!</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>{offer.voucherCode}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        {offer.sources.map(s => (
                          <span 
                            key={s} 
                            style={{ 
                              fontSize: 10, 
                              padding: '2px 6px', 
                              background: 'var(--bg-surface-elevated)', 
                              borderRadius: 4,
                              textTransform: 'uppercase',
                              color: 'var(--text-muted)'
                            }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <a
                        href={offer.dealUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        Buy
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
