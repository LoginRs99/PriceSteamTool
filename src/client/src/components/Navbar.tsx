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
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  syncProgress,
  onOpenProfiles,
  onOpenSources,
  onOpenDiscord,
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
          <span>{isSyncing ? 'Syncing...' : 'Sync Wishlist'}</span>
        </button>
      </div>
    </header>
  );
};
