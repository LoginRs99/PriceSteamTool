import React, { useRef, useEffect } from 'react';
import type { WishlistFilterOptions, ViewMode } from '../types.js';
import { Search, Flame, Sparkles, ShieldCheck, Tag, LayoutGrid, List, Table as TableIcon, X, RotateCcw } from 'lucide-react';

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
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input, textarea or select
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }

      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentPill = filters.hasAnomaly 
    ? 'anomaly'
    : filters.majorDealsOnly
    ? 'major_deals'
    : filters.allTimeLowOnly
    ? 'atl'
    : filters.trustedOnly
    ? 'trusted'
    : filters.underPrice === 5
    ? 'under_5'
    : filters.underPrice === 10
    ? 'under_10'
    : filters.underPrice === 20
    ? 'under_20'
    : filters.saleOnly
    ? 'sale'
    : filters.merchantType === 'official' || (filters.merchantType as any) === 'official_only'
    ? 'official'
    : 'all';

  const isFiltered = currentPill !== 'all' || Boolean(filters.search);

  const setPill = (pill: string) => {
    switch (pill) {
      case 'all':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minPrice: undefined,
          maxPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'major_deals':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: true,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'atl':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: true,
          trustedOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'trusted':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: true,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'sale':
        onFilterChange({
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_5':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 5,
          maxPrice: 5,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_10':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 10,
          maxPrice: 10,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_20':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 20,
          maxPrice: 20,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'official':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          merchantType: 'official',
          hasAnomaly: false,
          page: 1
        });
        break;
    }
  };

  return (
    <div className="filter-bar-container">
      {/* Top Search & Controls Row */}
      <div className="filter-controls-row">
        <div className="search-box">
          <Search size={18} className="search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search games by title... (press /)"
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
          {/* Sorting */}
          <select
            className="select-input"
            value={filters.sort || 'priority'}
            onChange={(e) => onFilterChange({ sort: e.target.value as any, page: 1 })}
            aria-label="Sort wishlist games"
          >
            <option value="priority">Sort: Wishlist Priority</option>
            <option value="deal_score_desc">★ Highest Deal Score (0–100)</option>
            <option value="price_asc">Price: Lowest first</option>
            <option value="price_desc">Price: Highest first</option>
            <option value="discount_desc">Discount: Highest first</option>
            <option value="historical_low">Closest to All-Time Low</option>
            <option value="title_asc">Title (A - Z)</option>
          </select>

          {/* Page Size Selector */}
          <select
            className="select-input"
            style={{ width: 'auto', minWidth: 100 }}
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
          <div className="view-mode-group" role="group" aria-label="View Mode">
            <button
              className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => onViewModeChange('grid')}
              title="Grid View (Cards)"
              aria-label="Grid View (Cards)"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => onViewModeChange('list')}
              title="Compact List View (Dense Rows)"
              aria-label="Compact List View (Dense Rows)"
            >
              <List size={16} />
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => onViewModeChange('table')}
              title="Dense Table View (Data Table)"
              aria-label="Dense Table View (Data Table)"
            >
              <TableIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Quick Pills */}
      <div className="filter-pills-row">
        <button
          className={`pill-btn ${currentPill === 'all' && !filters.search ? 'active' : ''}`}
          onClick={() => setPill('all')}
        >
          All Paid Games ({totalGames})
        </button>

        <button
          className={`pill-btn ${currentPill === 'major_deals' ? 'active' : ''}`}
          onClick={() => setPill('major_deals')}
        >
          <Sparkles size={13} />
          <span>Major Deals</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'atl' ? 'active' : ''}`}
          onClick={() => setPill('atl')}
        >
          <Flame size={13} />
          <span>All-Time Low</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'trusted' ? 'active' : ''}`}
          onClick={() => setPill('trusted')}
        >
          <ShieldCheck size={13} />
          <span>Trusted Only</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'sale' ? 'active' : ''}`}
          onClick={() => setPill('sale')}
        >
          <Tag size={13} />
          <span>On Sale</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'under_5' ? 'active' : ''}`}
          onClick={() => setPill('under_5')}
        >
          Under €5
        </button>

        <button
          className={`pill-btn ${currentPill === 'under_10' ? 'active' : ''}`}
          onClick={() => setPill('under_10')}
        >
          Under €10
        </button>

        <button
          className={`pill-btn ${currentPill === 'under_20' ? 'active' : ''}`}
          onClick={() => setPill('under_20')}
        >
          Under €20
        </button>

        <button
          className={`pill-btn ${currentPill === 'official' ? 'active' : ''}`}
          onClick={() => setPill('official')}
        >
          Official Stores
        </button>

        {filters.hasAnomaly && (
          <button
            className="pill-btn active"
            style={{ background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}
            onClick={() => setPill('all')}
          >
            ⚠️ High Risk Anomaly Active (Click to clear)
          </button>
        )}

        {isFiltered && (
          <button
            type="button"
            className="pill-btn"
            style={{ 
              marginLeft: 'auto', 
              background: 'rgba(255, 255, 255, 0.06)', 
              color: 'var(--text-muted)',
              borderStyle: 'dashed'
            }}
            onClick={() => {
              setPill('all');
              onFilterChange({ search: '', page: 1 });
            }}
            title="Reset all filters and search"
          >
            <RotateCcw size={12} />
            <span>Reset filters</span>
          </button>
        )}
      </div>
    </div>
  );
};
