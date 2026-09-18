import React from 'react';
import type { Profile, SyncProgressUpdate } from '../types.js';
import { RefreshCw, User, Activity, Download } from 'lucide-react';

interface NavbarProps {
  activeProfile: Profile | null;
  syncProgress: SyncProgressUpdate | null;
  onOpenProfiles: () => void;
  onOpenSources: () => void;
  onOpenDiscord: () => void;
  onTriggerSync: () => void;
  onLogoClick?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  syncProgress,
  onOpenProfiles,
  onOpenSources,
  onOpenDiscord,
  onTriggerSync,
  onLogoClick,
}) => {
  const isSyncing = syncProgress?.status === 'RUNNING';
  const percent = syncProgress && syncProgress.totalGames > 0 
    ? Math.round((syncProgress.processedGames / syncProgress.totalGames) * 100) 
    : 0;

  return (
    <header className="navbar">
      {isSyncing && (
        <div 
          className="topline-sync-progress" 
          role="progressbar" 
          aria-valuenow={percent} 
          aria-valuemin={0} 
          aria-valuemax={100}
          aria-label="Wishlist synchronization progress"
        >
          <div className="topline-sync-bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      <div 
        className="brand"
        onClick={onLogoClick}
        role={onLogoClick ? "button" : undefined}
        tabIndex={onLogoClick ? 0 : undefined}
        onKeyDown={onLogoClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLogoClick(); } } : undefined}
        style={{ cursor: onLogoClick ? 'pointer' : 'default', userSelect: 'none' }}
        title={onLogoClick ? "Return to Wishlist Deals" : undefined}
      >
        <div className="brand-icon">⚡</div>
        <div className="brand-name">
          PRICETOOL
          <span className="brand-badge">Self-Hosted</span>
          <span className={`telemetry-badge ${isSyncing ? 'pulse-syncing' : activeProfile ? 'pulse-live' : 'pulse-idle'}`}>
            <span className="telemetry-dot" />
            {isSyncing ? `SYNCING ${percent > 0 ? `${percent}%` : 'ACTIVE'}` : activeProfile ? 'ENGINE LIVE' : 'STANDBY'}
          </span>
        </div>
      </div>

      <div className="nav-actions">
        {/* Export All Offers as CSV */}
        <a 
          href="/api/export/offers.csv" 
          download="priceSteamTool-offers-export.csv" 
          className="btn btn-outline" 
          title="Export all current offers for wishlist games as CSV"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Download size={15} />
          <span>Export CSV</span>
        </a>

        {/* Discord Webhook Deal Alerts */}
        <button className="btn btn-outline" onClick={onOpenDiscord} title="Discord Webhook Deal Alerts">
          <span style={{ color: '#5865F2' }}>🔔</span>
          <span>Discord</span>
        </button>

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
          <span>{isSyncing ? `Syncing${percent > 0 ? ` (${percent}%)` : '...'}` : 'Sync Wishlist'}</span>
        </button>
      </div>
    </header>
  );
};
