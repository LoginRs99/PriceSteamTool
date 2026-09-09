import React from 'react';
import type { WishlistFilterOptions } from '../../types.js';
import { X } from 'lucide-react';

interface ActiveFilterBadgesProps {
  filters: WishlistFilterOptions;
  isFiltered: boolean;
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void;
  onResetAll: () => void;
}

export const ActiveFilterBadges: React.FC<ActiveFilterBadgesProps> = ({
  filters,
  isFiltered,
  onFilterChange,
  onResetAll
}) => {
  if (!isFiltered) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
        Active:
      </span>

      {filters.search && (
        <span className="filter-active-tag">
          Search: "{filters.search}"
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ search: '', page: 1 })} />
        </span>
      )}

      {filters.buyOnly && (
        <span className="filter-active-tag" style={{ borderColor: 'rgba(251, 191, 36, 0.4)', color: '#fbbf24' }}>
          🔥 Buy Recommendations
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ buyOnly: false, minDealScore: filters.minDealScore === 70 ? undefined : filters.minDealScore, page: 1 })} />
        </span>
      )}

      {filters.targetReachedOnly && (
        <span className="filter-active-tag" style={{ borderColor: 'rgba(34, 211, 165, 0.4)', color: 'var(--down)' }}>
          🎯 Target Reached
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ targetReachedOnly: false, page: 1 })} />
        </span>
      )}

      {filters.minDealScore !== undefined && filters.minDealScore > 0 && (
        <span className="filter-active-tag">
          Score ≥ {filters.minDealScore}
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ minDealScore: undefined, page: 1 })} />
        </span>
      )}

      {filters.minDiscount !== undefined && filters.minDiscount > 0 && (
        <span className="filter-active-tag">
          Discount ≥ {filters.minDiscount}%
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ minDiscount: undefined, page: 1 })} />
        </span>
      )}

      {filters.minPrice !== undefined && filters.minPrice > 0 && (
        <span className="filter-active-tag">
          Min: €{filters.minPrice}
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ minPrice: undefined, page: 1 })} />
        </span>
      )}

      {filters.maxPrice !== undefined && filters.maxPrice > 0 && (
        <span className="filter-active-tag">
          Max: €{filters.maxPrice}
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ maxPrice: undefined, underPrice: undefined, page: 1 })} />
        </span>
      )}

      {filters.merchantType === 'official' && (
        <span className="filter-active-tag">
          Official Stores Only
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ merchantType: 'all', page: 1 })} />
        </span>
      )}

      {filters.merchantType === 'keyshop' && (
        <span className="filter-active-tag">
          Keyshops Only
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ merchantType: 'all', page: 1 })} />
        </span>
      )}

      {filters.allTimeLowOnly && (
        <span className="filter-active-tag">
          All-Time Low Only
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ allTimeLowOnly: false, page: 1 })} />
        </span>
      )}

      {filters.saleOnly && (
        <span className="filter-active-tag">
          On Sale Only
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ saleOnly: false, page: 1 })} />
        </span>
      )}

      {filters.hideUnreleased && (
        <span className="filter-active-tag">
          Hide Unreleased
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ hideUnreleased: false, page: 1 })} />
        </span>
      )}

      {filters.hideDlcs && (
        <span className="filter-active-tag">
          Hide DLCs
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ hideDlcs: false, page: 1 })} />
        </span>
      )}

      {filters.includeFreeGames && (
        <span className="filter-active-tag" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399' }}>
          Include Free Games
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ includeFreeGames: false, page: 1 })} />
        </span>
      )}

      {filters.hideFamilyShared && (
        <span className="filter-active-tag" style={{ borderColor: 'rgba(59, 130, 246, 0.4)', color: '#60a5fa' }}>
          👨‍👩‍👧 Hide Family Games
          <X size={12} className="tag-remove-icon" onClick={() => onFilterChange({ hideFamilyShared: false, page: 1 })} />
        </span>
      )}

      <button
        type="button"
        onClick={onResetAll}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-primary)',
          fontSize: 12,
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: '2px 4px'
        }}
      >
        Clear all
      </button>
    </div>
  );
};
