import React from 'react';
import type { PriceHistoryEntry } from '../../types.js';
import { Clock, ShieldCheck } from 'lucide-react';

interface PriceHistoryTableProps {
  history: PriceHistoryEntry[];
}

export const PriceHistoryTable: React.FC<PriceHistoryTableProps> = ({ history }) => {
  if (history.length === 0) return null;

  return (
    <div>
      <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={15} /> Recorded Price History ({history.length})
      </h4>
      <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', padding: 12 }}>
        <table className="offers-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Source</th>
              <th>Price</th>
              <th>Event / Score</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(h.recordedAt).toLocaleDateString()} {new Date(h.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td style={{ fontSize: 13 }}>
                  {h.merchantName || 'Store'} {h.isOfficial && <ShieldCheck size={12} color="#10b981" style={{ display: 'inline', verticalAlign: 'middle' }} />}
                </td>
                <td style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h.sourceCode}</td>
                <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  €{h.priceEur.toFixed(2)}
                  {h.discountPercent && h.discountPercent > 0 && (
                    <span style={{ fontSize: 11, color: '#34d399', marginLeft: 6 }}>-{h.discountPercent}%</span>
                  )}
                </td>
                <td>
                  {h.dealScore ? (
                    <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700 }}>
                      Score: {h.dealScore}
                    </span>
                  ) : h.priceEvent ? (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {h.priceEvent}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
