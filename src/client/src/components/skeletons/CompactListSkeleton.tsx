import React from 'react';

interface CompactListSkeletonProps {
  rows?: number;
}

export const CompactListSkeleton: React.FC<CompactListSkeletonProps> = ({ rows = 8 }) => {
  return (
    <div className="compact-list-container" style={{ display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none', userSelect: 'none' }}>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="compact-row" style={{ opacity: 0.7 }}>
          <div className="compact-left">
            <div className="skeleton-shimmer compact-priority" style={{ width: 22, height: 14, borderRadius: 3 }} />
            <div className="skeleton-shimmer compact-thumb" style={{ width: 60, height: 28, borderRadius: 4 }} />
            <div className="compact-title-wrap" style={{ gap: 6 }}>
              <div className="skeleton-shimmer" style={{ width: 180, height: 15, borderRadius: 4 }} />
              <div className="skeleton-shimmer" style={{ width: 60, height: 12, borderRadius: 3 }} />
            </div>
          </div>

          <div className="compact-mid">
            <div className="skeleton-shimmer" style={{ width: 90, height: 18, borderRadius: 3 }} />
            <div className="skeleton-shimmer" style={{ width: 70, height: 20, borderRadius: 12 }} />
            <div className="skeleton-shimmer" style={{ width: 85, height: 14, borderRadius: 3 }} />
          </div>

          <div className="compact-right">
            <div className="compact-pricing" style={{ gap: 4 }}>
              <div className="skeleton-shimmer" style={{ width: 60, height: 18, borderRadius: 4 }} />
              <div className="skeleton-shimmer" style={{ width: 40, height: 12, borderRadius: 3 }} />
            </div>
            <div className="skeleton-shimmer" style={{ width: 26, height: 26, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
};
