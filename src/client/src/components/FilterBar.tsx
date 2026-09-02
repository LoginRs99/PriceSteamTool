import React, { useState, useEffect } from 'react';
import type { WishlistFilterOptions, ViewMode } from '../types.js';
import { 
  Search, 
  X, 
  SlidersHorizontal 
} from 'lucide-react';
import { useFilterState } from './filter/useFilterState.js';
import { QuickFilterPills } from './filter/QuickFilterPills.js';
import { AdvancedFiltersDrawer } from './filter/AdvancedFiltersDrawer.js';
import { ViewModeToggle } from './filter/ViewModeToggle.js';
import { ActiveFilterBadges } from './filter/ActiveFilterBadges.js';

interface FilterBarProps {
  filters: WishlistFilterOptions;
  totalGames: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  totalGames,
  viewMode,
  onViewModeChange,
  onFilterChange,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    searchInputRef,
    activeFilterCount,
    isFiltered,
    resetAllFilters,
    setPill
  } = useFilterState(filters, onFilterChange);

  return (
    <div className="filter-bar-container">
      {/* Top Search & Primary Controls */}
      <div className="filter-controls-row">
        <div className="search-box">
          <Search size={18} className="search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search wishlist games... (press /)"
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
            className="search-input"
            aria-label="Search wishlist games by title"
          />
          {filters.search ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                onFilterChange({ search: '', page: 1 });
                searchInputRef.current?.focus();
              }}
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : (
            <span className="search-shortcut-badge" title="Press / to search">/</span>
          )}
        </div>

        <div className="filter-dropdowns">
          {/* Sorting Strategies */}
          <select
            className="select-input"
            value={filters.sort || 'best_value'}
            onChange={(e) => onFilterChange({ sort: e.target.value as any, page: 1 })}
            aria-label="Sort wishlist games"
          >
            <option value="best_value">🎯 Sort: Best Value Deal Score</option>
            <option value="deal_score_desc">★ Highest Deal Score (Pure Price)</option>
            <option value="near_atl">🔥 All-Time Low First</option>
            <option value="biggest_savings">💶 Biggest € Savings</option>
            <option value="price_drops">🏷️ Highest Discount %</option>
            <option value="price_asc">Price: Lowest first</option>
            <option value="price_desc">Price: Highest first</option>
            <option value="priority">Steam Wishlist Priority</option>
            <option value="title_asc">Title (A - Z)</option>
          </select>

          {/* Advanced Filter Drawer Trigger */}
          <button
            type="button"
            className={`btn btn-sm ${showAdvanced ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            title="Fine-tune filters (Deal Score slider, Price limits, Stores)"
            style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}
          >
            <SlidersHorizontal size={14} />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span style={{
                background: 'var(--down)',
                color: '#0a0b0e',
                borderRadius: '50%',
                width: 18,
                height: 18,
                fontSize: 11,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 2
              }}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Page Size Selector */}
          <select
            className="select-input"
            style={{ width: 'auto', minWidth: 90 }}
            value={filters.limit || 50}
            onChange={(e) => onFilterChange({ limit: parseInt(e.target.value, 10), page: 1 })}
            title="Items per page"
            aria-label="Items per page"
          >
            <option value="24">24 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
            <option value="200">200 / page</option>
          </select>

          {/* View Mode Toggle Buttons */}
          <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
        </div>
      </div>

      {/* Advanced Filter Settings Drawer */}
      {showAdvanced && (
        <AdvancedFiltersDrawer filters={filters} onFilterChange={onFilterChange} />
      )}

      {/* Filter Quick Pills */}
      <QuickFilterPills 
        filters={filters}
        totalGames={totalGames}
        isFiltered={isFiltered}
        onPillSelect={setPill}
        onResetAll={resetAllFilters}
      />

      {/* Active Filter Badges */}
      <ActiveFilterBadges
        filters={filters}
        isFiltered={isFiltered}
        onFilterChange={onFilterChange}
        onResetAll={resetAllFilters}
      />
    </div>
  );
};
