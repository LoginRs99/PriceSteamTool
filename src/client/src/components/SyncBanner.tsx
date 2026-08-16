import React from 'react';
import type { SyncProgressUpdate, SourceCode } from '../types.js';
import { XCircle, CheckCircle, AlertCircle } from 'lucide-react';

interface SyncBannerProps {
  progress: SyncProgressUpdate | null;
  onCancel: () => void;
}

export const SyncBanner: React.FC<SyncBannerProps> = ({ progress, onCancel }) => {
  if (!progress || progress.status === 'IDLE') {
    return null;
  }

  const isRunning = progress.status === 'RUNNING';
  const percent = progress.totalGames > 0 
    ? Math.round((progress.processedGames / progress.totalGames) * 100) 
    : 0;

  const sourceLabels: Record<SourceCode, string> = {
    steam: 'Steam Store',
    itad: 'ITAD',
    ggdeals: 'GG.deals',
    cheapshark: 'CheapShark',
    allkeyshop: 'AllKeyShop'
  };

  return (
    <div className="sync-banner">
      <div className="sync-header">
        <div className="sync-title">
          {isRunning ? (
            <>
              <div className="pulse-dot" />
              <span>Wishlist Sync Active</span>
            </>
          ) : progress.status === 'COMPLETED' ? (
            <>
              <CheckCircle size={18} color="#10b981" />
              <span>Sync Finished</span>
            </>
          ) : (
            <>
              <AlertCircle size={18} color="#ef4444" />
              <span>Sync {progress.status}</span>
            </>
          )}
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
            {progress.currentAction}
          </span>
        </div>

        {isRunning && (
          <button 
            className="btn btn-outline" 
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={onCancel}
          >
            <XCircle size={14} />
            <span>Cancel</span>
          </button>
        )}
      </div>

      {progress.totalGames > 0 && (
        <div className="progress-bar-container">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* Per-source progress indicators */}
      <div className="source-badges-row">
        {(Object.keys(progress.sourceProgress) as SourceCode[]).map(code => {
          const s = progress.sourceProgress[code];
          if (!s || (s.total === 0 && s.processed === 0 && s.offersFound === 0)) return null;

          const stateClass = s.state.toLowerCase();

          return (
            <div key={code} className={`source-badge ${stateClass}`}>
              <span style={{ fontWeight: 700 }}>{sourceLabels[code] || code}:</span>
              <span>{s.processed}/{s.total || progress.totalGames}</span>
              {s.offersFound > 0 && (
                <span style={{ color: 'var(--accent-primary)', marginLeft: 4 }}>
                  ({s.offersFound} deals)
                </span>
              )}
              {s.state !== 'NORMAL' && (
                <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.8 }}>
                  [{s.state}]
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
