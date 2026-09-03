import React from 'react';

interface GameCardSkeletonProps {
  count?: number;
}

export const GameCardSkeleton: React.FC<GameCardSkeletonProps> = ({ count = 1 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="game-card" style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {/* Image Skeleton */}
          <div 
            className="game-card-image-wrap skeleton-shimmer" 
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0' }}
          />

          {/* Body Skeleton */}
          <div className="game-card-body" style={{ gap: 12 }}>
            <div>
              {/* Title line */}
              <div 
                className="skeleton-shimmer" 
                style={{ width: '75%', height: 18, borderRadius: 4, marginBottom: 8 }} 
              />
              {/* Context sub-line */}
              <div 
                className="skeleton-shimmer" 
                style={{ width: '50%', height: 12, borderRadius: 4 }} 
              />
            </div>

            {/* Meta row */}
            <div className="game-meta-row" style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div 
                className="skeleton-shimmer" 
                style={{ width: 64, height: 22, borderRadius: 4 }} 
              />
              <div 
                className="skeleton-shimmer" 
                style={{ width: 80, height: 18, borderRadius: 4 }} 
              />
            </div>
          </div>
        </div>
      ))}
    </>
  );
};
