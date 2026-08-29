import React from 'react';
import type { WishlistFilterOptions } from '../../types.js';

interface AdvancedFiltersDrawerProps {
  filters: WishlistFilterOptions;
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void;
}

export const AdvancedFiltersDrawer: React.FC<AdvancedFiltersDrawerProps> = ({
  filters,
  onFilterChange
}) => {
  return (
    <div className="advanced-filters-panel" style={{
      background: 'var(--surface)',
      padding: '16px 20px',
      borderRadius: 'var(--radius-md)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 20,
      alignItems: 'flex-start',
      border: '1px solid var(--line)',
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)'
    }}>
      {/* Min Deal Score Slider */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--dim)' }}>
            Minimum Deal Score
          </label>
          <span className="ticker-num" style={{
            fontSize: 12,
            fontWeight: 700,
            color: (filters.minDealScore || 0) >= 85 ? 'var(--accent-purple)' : (filters.minDealScore || 0) >= 70 ? 'var(--down)' : 'var(--ink)',
            background: 'var(--bg-void)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line)'
          }}>
            {filters.minDealScore ? `${filters.minDealScore} / 100` : 'Any Score'}
          </span>
        </div>
        <input 
          type="range" 
          min="0" 
          max="95" 
          step="5"
          value={filters.minDealScore || 0}
          onChange={(e) => onFilterChange({ minDealScore: parseInt(e.target.value, 10) || undefined, page: 1 })}
          style={{ accentColor: 'var(--down)', cursor: 'pointer', width: '100%' }}
        />
      </div>

      {/* Price Range Filter */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--dim)' }}>
          Price Range (€ EUR)
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            placeholder="Min €"
            min="0"
            value={filters.minPrice ?? ''}
            onChange={(e) => onFilterChange({ minPrice: e.target.value ? parseFloat(e.target.value) : undefined, page: 1 })}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: 13
            }}
          />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input
            type="number"
            placeholder="Max €"
            min="0"
            value={filters.maxPrice ?? ''}
            onChange={(e) => onFilterChange({ maxPrice: e.target.value ? parseFloat(e.target.value) : undefined, page: 1 })}
            style={{
              width: '100%',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: 13
            }}
          />
        </div>
      </div>

      {/* Store Type Selection */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Store Verification
        </label>
        <select
          className="select-input"
          style={{ padding: '7px 12px', fontSize: 13 }}
          value={filters.merchantType || 'all'}
          onChange={(e) => onFilterChange({ merchantType: e.target.value as any, page: 1 })}
        >
          <option value="all">All Stores (Official & Authorized Keyshops)</option>
          <option value="official">Official Stores Only (Steam, Humble, etc.)</option>
          <option value="keyshop">Authorized Keyshops Only</option>
        </select>
      </div>

      {/* Clean Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.82rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input 
            type="checkbox"
            checked={Boolean(filters.hideAnomalies)}
            onChange={(e) => onFilterChange({ hideAnomalies: e.target.checked, page: 1 })}
          />
          <span>Hide High-Risk Anomalies</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input 
            type="checkbox"
            checked={Boolean(filters.majorDealsOnly)}
            onChange={(e) => onFilterChange({ majorDealsOnly: e.target.checked, page: 1 })}
          />
          <span>Major Price Drops Only</span>
        </label>
      </div>
    </div>
  );
};
