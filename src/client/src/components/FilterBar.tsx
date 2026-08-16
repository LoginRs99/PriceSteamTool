import React, { useRef, useEffect, useState } from 'react';
import type { WishlistFilterOptions, ViewMode } from '../types.js';
import { 
  Search, 
  Flame, 
  Sparkles, 
  ShieldCheck, 
  Tag, 
  LayoutGrid, 
  List, 
  Table as TableIcon, 
  X, 
  RotateCcw, 
  SlidersHorizontal,
  Sliders
} from 'lucide-react';

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    : filters.buyOnly
    ? 'buy_recommendations'
    : filters.sort === 'best_value' && (filters.minDealScore === 70)
    ? 'best_deals'
    : filters.minDealScore === 85
    ? 'exceptional'
    : (filters.minConfidence || 0) >= 80
    ? 'high_conf'
    : filters.allTimeLowOnly
    ? 'atl'
    : filters.sort === 'biggest_savings'
    ? 'savings'
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

  const isFiltered = currentPill !== 'all' || 
    Boolean(filters.search) || 
    Boolean(filters.buyOnly) ||
    Boolean(filters.minDealScore) || 
    Boolean(filters.minConfidence) || 
    Boolean(filters.hideAnomalies) || 
    Boolean(filters.hideProvisional);

  const resetAllFilters = () => {
    onFilterChange({
      search: '',
      sort: 'best_value',
      saleOnly: false,
      majorDealsOnly: false,
      allTimeLowOnly: false,
      trustedOnly: false,
      underPrice: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minDealScore: undefined,
      minConfidence: undefined,
      hideAnomalies: false,
      hideProvisional: false,
      merchantType: 'all',
      hasAnomaly: false,
      page: 1
    });
  };

  const setPill = (pill: string) => {
    switch (pill) {
      case 'all':
        onFilterChange({
          sort: 'best_value',
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minPrice: undefined,
          maxPrice: undefined,
          minDealScore: undefined,
          minConfidence: undefined,
          hideAnomalies: false,
          hideProvisional: false,
          buyOnly: false,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'buy_recommendations':
        onFilterChange({
          sort: 'best_value',
          buyOnly: true,
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDealScore: 70,
          minConfidence: 35,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'best_deals':
        onFilterChange({
          sort: 'best_value',
          minDealScore: 70,
          minConfidence: 40,
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
      case 'exceptional':
        onFilterChange({
          sort: 'deal_score_desc',
          minDealScore: 85,
          minConfidence: 40,
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
      case 'high_conf':
        onFilterChange({
          sort: 'confidence_desc',
          minConfidence: 80,
          saleOnly: false,
          majorDealsOnly: false,
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
          sort: 'near_atl',
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: true,
          trustedOnly: false,
          underPrice: undefined,
          minDealScore: undefined,
          minConfidence: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'savings':
        onFilterChange({
          sort: 'biggest_savings',
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDealScore: undefined,
          minConfidence: undefined,
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
          minDealScore: undefined,
          minConfidence: undefined,
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
          minDealScore: undefined,
          minConfidence: undefined,
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
          minDealScore: undefined,
          minConfidence: undefined,
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
          {/* Sorting Strategies */}
          <select
            className="select-input"
            value={filters.sort || 'best_value'}
            onChange={(e) => onFilterChange({ sort: e.target.value as any, page: 1 })}
            aria-label="Sort wishlist games"
          >
            <option value="best_value">🎯 Sort: Best Value (Score + Confidence)</option>
            <option value="deal_score_desc">★ Highest Deal Score (Pure Price)</option>
            <option value="confidence_desc">🛡️ Highest Confidence (Data Depth)</option>
            <option value="near_atl">🔥 Closest to All-Time Low</option>
            <option value="biggest_savings">💶 Biggest € Drop vs Typical</option>
            <option value="price_drops">🏷️ Discount % (Highest first)</option>
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
            title="Fine-tune filters (Deal Score slider, Confidence threshold, etc.)"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <SlidersHorizontal size={14} />
            <span>Filters</span>
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

      {/* Advanced Filter Settings Drawer */}
      {showAdvanced && (
        <div className="advanced-filters-panel" style={{ background: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: 8, marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', border: '1px solid var(--border-color)' }}>
          {/* Min Deal Score */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Min Deal Score: <strong>{filters.minDealScore || 0} / 100</strong>
            </label>
            <input 
              type="range" 
              min="0" 
              max="95" 
              step="5"
              value={filters.minDealScore || 0}
              onChange={(e) => onFilterChange({ minDealScore: parseInt(e.target.value, 10) || undefined, page: 1 })}
              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
          </div>

          {/* Min Confidence */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Min Confidence: <strong>{filters.minConfidence || 0}%</strong>
            </label>
            <input 
              type="range" 
              min="0" 
              max="90" 
              step="10"
              value={filters.minConfidence || 0}
              onChange={(e) => onFilterChange({ minConfidence: parseInt(e.target.value, 10) || undefined, page: 1 })}
              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
          </div>

          {/* Checkbox Toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.82rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input 
                type="checkbox"
                checked={Boolean(filters.hideAnomalies)}
                onChange={(e) => onFilterChange({ hideAnomalies: e.target.checked, page: 1 })}
              />
              <span>Hide High-Risk Anomalies</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input 
                type="checkbox"
                checked={Boolean(filters.hideProvisional)}
                onChange={(e) => onFilterChange({ hideProvisional: e.target.checked, page: 1 })}
              />
              <span>Hide Provisional Deals (Sparse Data)</span>
            </label>
          </div>
        </div>
      )}

      {/* Filter Quick Pills */}
      <div className="filter-pills-row" style={{ marginTop: 10 }}>
        <button
          className={`pill-btn ${currentPill === 'all' && !isFiltered ? 'active' : ''}`}
          onClick={() => setPill('all')}
        >
          All Games ({totalGames})
        </button>

        <button
          className={`pill-btn ${currentPill === 'buy_recommendations' ? 'active' : ''}`}
          onClick={() => setPill('buy_recommendations')}
          style={{ borderColor: currentPill === 'buy_recommendations' ? '#10b981' : undefined }}
        >
          <Sparkles size={13} color="#10b981" />
          <span style={{ color: currentPill === 'buy_recommendations' ? '#10b981' : undefined, fontWeight: 700 }}>
            🔥 Buy Recommendations
          </span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'best_deals' ? 'active' : ''}`}
          onClick={() => setPill('best_deals')}
        >
          <Sparkles size={13} />
          <span>Best Deals (70+)</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'exceptional' ? 'active' : ''}`}
          onClick={() => setPill('exceptional')}
        >
          🔥 Exceptional (85+)
        </button>

        <button
          className={`pill-btn ${currentPill === 'high_conf' ? 'active' : ''}`}
          onClick={() => setPill('high_conf')}
        >
          <ShieldCheck size={13} />
          <span>High Confidence (80%+)</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'atl' ? 'active' : ''}`}
          onClick={() => setPill('atl')}
        >
          <Flame size={13} />
          <span>All-Time Low</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'savings' ? 'active' : ''}`}
          onClick={() => setPill('savings')}
        >
          💶 € Savings vs Typical
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
          className={`pill-btn ${currentPill === 'official' ? 'active' : ''}`}
          onClick={() => setPill('official')}
        >
          Official Stores
        </button>

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
            onClick={resetAllFilters}
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
