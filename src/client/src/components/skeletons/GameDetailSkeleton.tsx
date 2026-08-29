import React from 'react';
import { X } from 'lucide-react';

interface GameDetailSkeletonProps {
  onClose?: () => void;
}

export const GameDetailSkeleton: React.FC<GameDetailSkeletonProps> = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Loading game details">
      <div className="modal-content modal-intel-content" onClick={e => e.stopPropagation()} style={{ pointerEvents: 'none', userSelect: 'none' }}>
        {/* Header Skeleton */}
        <div className="modal-header">
          <div>
            <div className="skeleton-shimmer" style={{ width: 240, height: 24, borderRadius: 4, marginBottom: 8 }} />
            <p style={{ fontSize: 13, color: 'var(--dim)', margin: 0 }}>Loading price intelligence & deal history...</p>
          </div>
          {onClose && (
            <button className="btn btn-outline" style={{ padding: 6, pointerEvents: 'auto' }} onClick={onClose} aria-label="Close modal">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Decision Hero Skeleton */}
          <div 
            className="skeleton-shimmer" 
            style={{ width: '100%', height: 140, borderRadius: 'var(--radius-lg)' }} 
          />

          {/* Period Lows Grid Skeleton */}
          <div className="period-lows-grid">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="period-card skeleton-shimmer" style={{ height: 80, borderRadius: 'var(--radius-md)' }} />
            ))}
          </div>

          {/* Price Chart Skeleton */}
          <div 
            className="skeleton-shimmer" 
            style={{ width: '100%', height: 220, borderRadius: 'var(--radius-md)' }} 
          />

          {/* Intel Metrics Grid Skeleton */}
          <div className="intel-metrics-grid">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="intel-card skeleton-shimmer" style={{ height: 95, borderRadius: 'var(--radius-md)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
