import React from 'react';
import type { Profile, SyncProgressUpdate } from '../types.js';
import { RefreshCw, User, Activity, AlertTriangle } from 'lucide-react';

interface NavbarProps {
  activeProfile: Profile | null;
  syncProgress: SyncProgressUpdate | null;
  anomalyCount: number;
  onOpenProfiles: () => void;
  onOpenSources: () => void;
  onOpenAnomalies: () => void;
  onTriggerSync: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  syncProgress,
  anomalyCount,
  onOpenProfiles,
  onOpenSources,
  onOpenAnomalies,
  onTriggerSync,
}) => {
  const isSyncing = syncProgress?.status === 'RUNNING';

  return (
    <header className="navbar">
      <div className="brand">
        <div className="brand-icon">⚡</div>
        <div className="brand-name">
          PRICETOOL
          <span className="brand-badge">Self-Hosted</span>
        </div>
      </div>

      <div className="nav-actions">
        {/* Anomaly Indicator */}
        {anomalyCount > 0 && (
          <button 
            className="btn btn-outline" 
            style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
            onClick={onOpenAnomalies}
          >
            <AlertTriangle size={16} />
            <span>{anomalyCount} {anomalyCount === 1 ? 'Anomaly' : 'Anomalies'}</span>
          </button>
        )}

        {/* Source Health & Diagnostics */}
        <button className="btn btn-outline" onClick={onOpenSources} title="Source Adapter Health">
          <Activity size={16} />
          <span>Sources</span>
        </button>

        {/* Profile Switcher */}
        <button className="btn btn-secondary" onClick={onOpenProfiles}>
          <User size={16} />
          <span>{activeProfile ? activeProfile.name : 'Select Profile'}</span>
        </button>

        {/* Sync Wishlist Action */}
        <button 
          className="btn btn-primary" 
          onClick={onTriggerSync}
          disabled={isSyncing || !activeProfile}
          title={!activeProfile ? 'Configure a Steam profile first' : 'Synchronize wishlist and prices'}
        >
          <RefreshCw size={16} className={isSyncing ? 'spin-icon' : ''} />
          <span>{isSyncing ? 'Syncing...' : 'Sync Wishlist'}</span>
        </button>
      </div>
    </header>
  );
};
