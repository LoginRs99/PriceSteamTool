import React from 'react';

interface DenseTableSkeletonProps {
  rows?: number;
}

export const DenseTableSkeleton: React.FC<DenseTableSkeletonProps> = ({ rows = 8 }) => {
  return (
    <div className="dense-table-wrapper" style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <table className="dense-table">
        <thead>
          <tr>
            <th style={{ width: 45 }}>#</th>
            <th>Title</th>
            <th style={{ width: 120 }}>Trend</th>
            <th style={{ width: 85 }}>MSRP</th>
            <th style={{ width: 105 }}>Best Deal</th>
            <th style={{ width: 90 }}>Discount</th>
            <th style={{ width: 130 }}>Deal Score</th>
            <th style={{ width: 140 }}>Best Store</th>
            <th style={{ width: 95 }}>ATL</th>
            <th style={{ width: 75, textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, idx) => (
            <tr key={idx} className="dense-table-row">
              {/* 1. Priority */}
              <td className="cell-priority">
                <div className="skeleton-shimmer" style={{ width: 22, height: 14, borderRadius: 3 }} />
              </td>

              {/* 2. Title & Flag */}
              <td className="cell-title">
                <div className="table-title-wrap" style={{ gap: 8 }}>
                  <div className="skeleton-shimmer" style={{ width: 140, height: 16, borderRadius: 4 }} />
                  <div className="skeleton-shimmer" style={{ width: 42, height: 16, borderRadius: 4 }} />
                </div>
              </td>

              {/* 3. Trend */}
              <td className="cell-sparkline">
                <div className="skeleton-shimmer" style={{ width: 100, height: 18, borderRadius: 3 }} />
              </td>

              {/* 4. MSRP */}
              <td className="cell-msrp">
                <div className="skeleton-shimmer" style={{ width: 45, height: 14, borderRadius: 3 }} />
              </td>

              {/* 5. Best Deal */}
              <td className="cell-price">
                <div className="skeleton-shimmer" style={{ width: 55, height: 16, borderRadius: 4 }} />
              </td>

              {/* 6. Discount */}
              <td className="cell-discount">
                <div className="skeleton-shimmer" style={{ width: 38, height: 14, borderRadius: 3 }} />
              </td>

              {/* 7. Deal Score */}
              <td className="cell-score">
                <div className="skeleton-shimmer" style={{ width: 75, height: 20, borderRadius: 4 }} />
              </td>

              {/* 8. Best Store */}
              <td className="cell-store">
                <div className="skeleton-shimmer" style={{ width: 85, height: 14, borderRadius: 3 }} />
              </td>

              {/* 9. ATL */}
              <td className="cell-atl">
                <div className="skeleton-shimmer" style={{ width: 45, height: 14, borderRadius: 3 }} />
              </td>

              {/* 10. Action */}
              <td className="cell-action">
                <div className="skeleton-shimmer" style={{ width: 45, height: 24, borderRadius: 4, marginLeft: 'auto' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
