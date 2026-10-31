import React from 'react';
import type { Profile, SyncProgressUpdate, SourceStatus } from '../types.js';
import { RefreshCw, User, Activity, Download, Globe, Bell, Zap, HelpCircle } from 'lucide-react';
import { useCurrency, CURRENCY_MAP, type SupportedCurrency } from '../context/CurrencyContext.js';

interface NavbarProps {
  activeProfile: Profile | null;
  syncProgress: SyncProgressUpdate | null;
  sources?: SourceStatus[];
  onOpenProfiles: () => void;
  onOpenSources: () => void;
  onOpenDiscord: () => void;
  onTriggerSync: () => void;
  onLogoClick?: () => void;
  onOpenShortcuts?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeProfile,
  syncProgress,
  sources,
  onOpenProfiles,
  onOpenSources,
  onOpenDiscord,
  onTriggerSync,
  onLogoClick,
  onOpenShortcuts,
}) => {
  const hasDegradedSource = (sources && sources.some(s => s.isEnabled && (s.state === 'BACKOFF' || s.state === 'COOLDOWN' || s.state === 'PAUSED' || s.failureCount > 0 || s.rateLimitCount > 0)))
    || (syncProgress?.sourceProgress ? Object.values(syncProgress.sourceProgress).some(p => p.state === 'BACKOFF' || p.state === 'PAUSED') : false);
  const { currency, setCurrency } = useCurrency();
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
        <div className="brand-icon"><Zap size={16} fill="currentColor" /></div>
        <div className="brand-name">
          PRICETOOL
          <span className="brand-badge">Self-Hosted</span>
          <span className={`telemetry-badge ${isSyncing ? 'pulse-syncing' : activeProfile ? 'pulse-live' : 'pulse-idle'}`}>
            <span className="telemetry-dot" />
            {isSyncing ? `SYNCING ${percent > 0 ? `${percent}%` : 'ACTIVE'}` : activeProfile ? 'ENGINE LIVE' : 'READY'}
          </span>
        </div>
      </div>

      <div className="nav-actions">
        {/* Currency Switcher */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative' }}>
          <Globe size={14} style={{ color: 'var(--text-muted)' }} />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
            className="btn btn-outline"
            style={{
              padding: '5px 8px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: 'var(--bg-surface-elevated)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)'
            }}
            title="Switch display currency"
          >
            {Object.values(CURRENCY_MAP).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

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
          <Bell size={15} style={{ color: '#5865F2' }} />
          <span>Discord</span>
        </button>

        {/* Source Health & Diagnostics */}
        <button 
          className="btn btn-outline" 
          onClick={onOpenSources} 
          title={hasDegradedSource ? 'Some upstream sources in backoff/cooldown' : 'All upstream sources healthy'}
          style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Activity size={16} />
          <span>Sources</span>
          <span 
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: hasDegradedSource ? '#f59e0b' : '#10b981',
              display: 'inline-block',
              boxShadow: hasDegradedSource ? '0 0 5px rgba(245, 158, 11, 0.6)' : '0 0 5px rgba(16, 185, 129, 0.6)'
            }}
          />
        </button>

        {/* Global Keyboard Shortcuts */}
        {onOpenShortcuts && (
          <button 
            className="btn btn-outline" 
            onClick={onOpenShortcuts} 
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts (?)"
            style={{ padding: '6px 8px', display: 'inline-flex', alignItems: 'center' }}
          >
            <HelpCircle size={15} />
          </button>
        )}

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
