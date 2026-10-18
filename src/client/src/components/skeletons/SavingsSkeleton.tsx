import React from 'react';

export const SavingsSkeleton: React.FC = () => {
  return (
    <div className="savings-view-container savings-skeleton-container" data-testid="savings-skeleton" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 0 40px', pointerEvents: 'none', userSelect: 'none' }}>
      {/* Top Banner Skeleton */}
      <div style={{ marginBottom: 24 }}>
        <div className="skeleton-shimmer" style={{ width: 280, height: 26, borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton-shimmer" style={{ width: 460, height: 16, borderRadius: 4 }} />
      </div>

      {/* 3 Metric Cards Skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[1, 2, 3].map(i => (
          <div 
            key={i} 
            style={{ 
              background: 'var(--surface)', 
              border: '1px solid var(--line)', 
              borderRadius: 'var(--radius-lg, 8px)', 
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="skeleton-shimmer" style={{ width: 110, height: 14, borderRadius: 4 }} />
              <div className="skeleton-shimmer" style={{ width: 28, height: 28, borderRadius: '50%' }} />
            </div>
            <div className="skeleton-shimmer" style={{ width: 140, height: 32, borderRadius: 6 }} />
            <div className="skeleton-shimmer" style={{ width: 180, height: 13, borderRadius: 4 }} />
          </div>
        ))}
      </div>

      {/* Table Skeleton */}
      <div className="dense-table-wrapper" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-lg, 8px)' }}>
        <table className="dense-table">
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Game Title</th>
              <th style={{ width: '15%' }}>Store</th>
              <th style={{ width: '15%' }}>Price Paid</th>
              <th style={{ width: '15%' }}>Saved vs MSRP</th>
              <th style={{ width: '15%' }}>Purchase Date</th>
              <th style={{ width: '5%', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map(i => (
              <tr key={i} className="dense-table-row">
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="skeleton-shimmer" style={{ width: 48, height: 24, borderRadius: 4 }} />
                    <div className="skeleton-shimmer" style={{ width: 160 + (i * 15), height: 16, borderRadius: 4 }} />
                  </div>
                </td>
                <td>
                  <div className="skeleton-shimmer" style={{ width: 80, height: 14, borderRadius: 4 }} />
                </td>
                <td>
                  <div className="skeleton-shimmer" style={{ width: 65, height: 16, borderRadius: 4 }} />
                </td>
                <td>
                  <div className="skeleton-shimmer" style={{ width: 75, height: 16, borderRadius: 4 }} />
                </td>
                <td>
                  <div className="skeleton-shimmer" style={{ width: 90, height: 14, borderRadius: 4 }} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="skeleton-shimmer" style={{ width: 24, height: 24, borderRadius: 4, marginLeft: 'auto' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
