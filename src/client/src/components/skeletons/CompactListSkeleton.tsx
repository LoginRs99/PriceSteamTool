import React from 'react';

interface CompactListSkeletonProps {
  rows?: number;
}

export const CompactListSkeleton: React.FC<CompactListSkeletonProps> = ({ rows = 8 }) => {
  return (
    <div className="compact-list-container" style={{ pointerEvents: 'none', userSelect: 'none' }}>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="compact-row">
          {/* Priority & Thumb */}
          <div className="compact-left">
            <div className="skeleton-shimmer" style={{ width: 22, height: 16, borderRadius: 3 }} />
            <div className="compact-thumb skeleton-shimmer" style={{ width: 68, height: 32, borderRadius: 4 }} />
            <div className="compact-title-wrap" style={{ gap: 6 }}>
              <div className="skeleton-shimmer" style={{ width: 150, height: 15, borderRadius: 4 }} />
              <div className="skeleton-shimmer" style={{ width: 45, height: 14, borderRadius: 3 }} />
            </div>
          </div>

          {/* Sparkline */}
          <div className="compact-sparkline-wrap" style={{ width: 100, padding: '0 8px' }}>
            <div className="skeleton-shimmer" style={{ width: '100%', height: 18, borderRadius: 3 }} />
          </div>

          {/* Mid: Score & Store */}
          <div className="compact-mid" style={{ gap: 10 }}>
            <div className="skeleton-shimmer" style={{ width: 75, height: 22, borderRadius: 4 }} />
            <div className="skeleton-shimmer" style={{ width: 85, height: 14, borderRadius: 3 }} />
          </div>

          {/* Right: Prices & Action */}
          <div className="compact-right" style={{ gap: 12 }}>
            <div className="compact-pricing" style={{ alignItems: 'flex-end', gap: 4 }}>
              <div className="skeleton-shimmer" style={{ width: 60, height: 16, borderRadius: 4 }} />
              <div className="skeleton-shimmer" style={{ width: 45, height: 12, borderRadius: 3 }} />
            </div>
            <div className="skeleton-shimmer" style={{ width: 60, height: 28, borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
};
