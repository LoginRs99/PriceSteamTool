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
  DollarSign,
  TrendingDown,
  Check
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

  // Determine active preset pill
  const getActivePill = () => {
    if (filters.hasAnomaly) return 'anomaly';
    if (filters.buyOnly) return 'buy_recommendations';
    if ((filters.minDealScore ?? 0) >= 85) return 'exceptional';
    if ((filters.minDealScore ?? 0) >= 70) return 'best_deals';
    if (filters.minDiscount === 75) return 'discount_75';
    if (filters.minDiscount === 50) return 'discount_50';
    if (filters.allTimeLowOnly) return 'atl';
    if (filters.underPrice === 5 || filters.maxPrice === 5) return 'under_5';
    if (filters.underPrice === 10 || filters.maxPrice === 10) return 'under_10';
    if (filters.underPrice === 20 || filters.maxPrice === 20) return 'under_20';
    if (filters.merchantType === 'official') return 'official';
    if (filters.merchantType === 'keyshop') return 'keyshop';
    if (filters.saleOnly) return 'sale';
    return 'all';
  };

  const currentPill = getActivePill();

  // Calculate active filter count for badge
  let activeFilterCount = 0;
  if (filters.search) activeFilterCount++;
  if (filters.buyOnly) activeFilterCount++;
  if (filters.saleOnly) activeFilterCount++;
  if (filters.minDiscount && filters.minDiscount > 0) activeFilterCount++;
  if (filters.allTimeLowOnly) activeFilterCount++;
  if (filters.majorDealsOnly) activeFilterCount++;
  if (filters.trustedOnly) activeFilterCount++;
  if (filters.minDealScore && filters.minDealScore > 0) activeFilterCount++;
  if (filters.minPrice !== undefined && filters.minPrice > 0) activeFilterCount++;
  if (filters.maxPrice !== undefined && filters.maxPrice > 0) activeFilterCount++;
  if (filters.underPrice !== undefined && filters.underPrice > 0) activeFilterCount++;
  if (filters.merchantType && filters.merchantType !== 'all') activeFilterCount++;
  if (filters.hideAnomalies) activeFilterCount++;
  if (filters.hideProvisional) activeFilterCount++;

  const isFiltered = activeFilterCount > 0 || (filters.sort && filters.sort !== 'best_value');

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
      minDiscount: undefined,
      minDealScore: undefined,
      hideAnomalies: false,
      hideProvisional: false,
      buyOnly: false,
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
          minDiscount: undefined,
          minDealScore: undefined,
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
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDiscount: undefined,
          minDealScore: 70,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'best_deals':
        onFilterChange({
          sort: 'best_value',
          minDealScore: 70,
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDiscount: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'exceptional':
        onFilterChange({
          sort: 'deal_score_desc',
          minDealScore: 85,
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDiscount: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'discount_75':
        onFilterChange({
          sort: 'price_drops',
          minDiscount: 75,
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDealScore: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'discount_50':
        onFilterChange({
          sort: 'price_drops',
          minDiscount: 50,
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDealScore: undefined,
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
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'sale':
        onFilterChange({
          sort: 'price_drops',
          saleOnly: true,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_5':
        onFilterChange({
          sort: 'price_asc',
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 5,
          maxPrice: 5,
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_10':
        onFilterChange({
          sort: 'price_asc',
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 10,
          maxPrice: 10,
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_20':
        onFilterChange({
          sort: 'price_asc',
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: 20,
          maxPrice: 20,
          minDiscount: undefined,
          minDealScore: undefined,
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
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'official',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'keyshop':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          minDiscount: undefined,
          minDealScore: undefined,
          merchantType: 'keyshop',
          hasAnomaly: false,
          page: 1
        });
        break;
    }
  };

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
                background: 'var(--accent-primary)',
                color: '#042f2e',
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
        <div className="advanced-filters-panel" style={{
          background: 'var(--bg-surface-elevated)',
          padding: '16px 20px',
          borderRadius: 'var(--radius-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
          alignItems: 'flex-start',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
        }}>
          {/* Min Deal Score Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Minimum Deal Score
              </label>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: (filters.minDealScore || 0) >= 85 ? '#8b5cf6' : (filters.minDealScore || 0) >= 70 ? '#10b981' : 'var(--text-primary)',
                background: 'var(--bg-surface)',
                padding: '2px 8px',
                borderRadius: 10,
                border: '1px solid var(--border-subtle)'
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
              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer', width: '100%' }}
            />
          </div>

          {/* Price Range Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
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
      )}

      {/* Filter Quick Pills */}
      <div className="filter-pills-row">
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
          <span>Great Deals (70+)</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'exceptional' ? 'active' : ''}`}
          onClick={() => setPill('exceptional')}
        >
          🔥 Exceptional (85+)
        </button>

        <button
          className={`pill-btn ${currentPill === 'atl' ? 'active' : ''}`}
          onClick={() => setPill('atl')}
        >
          <Flame size={13} />
          <span>All-Time Low</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'sale' ? 'active' : ''}`}
          onClick={() => setPill('sale')}
        >
          <Tag size={13} />
          <span>On Sale</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'discount_50' ? 'active' : ''}`}
          onClick={() => setPill('discount_50')}
        >
          <span>-50%+ Off</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'discount_75' ? 'active' : ''}`}
          onClick={() => setPill('discount_75')}
        >
          <span>-75%+ Off</span>
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
          <ShieldCheck size={13} />
          <span>Official Only</span>
        </button>

        <button
          className={`pill-btn ${currentPill === 'keyshop' ? 'active' : ''}`}
          onClick={() => setPill('keyshop')}
        >
          <Tag size={13} />
          <span>Keyshops</span>
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

      {/* Active Filter Badges */}
      {isFiltered && (
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

          <button
            type="button"
            onClick={resetAllFilters}
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
      )}
    </div>
  );
};
