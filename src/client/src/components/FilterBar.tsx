import React from 'react';
import type { WishlistFilterOptions } from '../types.js';
import { Search, Flame, Sparkles, ShieldCheck, Tag } from 'lucide-react';

interface FilterBarProps {
  filters: WishlistFilterOptions;
  totalGames: number;
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  totalGames,
  onFilterChange,
}) => {
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
      case 'anomaly':
        onFilterChange({
          saleOnly: false,
          majorDealsOnly: false,
          allTimeLowOnly: false,
          trustedOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: true,
          page: 1
        });
        break;
    }
  };

  return (
    <div className="filter-bar">
      <div className="filter-top-row">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search wishlist games..."
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
          />
        </div>

        <div className="filter-controls-group">
          <select
            className="select-input"
            value={filters.sort || 'priority'}
            onChange={(e) => onFilterChange({ sort: e.target.value as any, page: 1 })}
          >
            <option value="priority">Sort: Wishlist Priority</option>
            <option value="deal_score_desc">★ Highest Deal Score (0–100)</option>
            <option value="price_asc">Price: Lowest first</option>
            <option value="price_desc">Price: Highest first</option>
            <option value="discount_desc">Discount: Highest first</option>
            <option value="historical_low">Closest to All-Time Low</option>
            <option value="title_asc">Title (A - Z)</option>
          </select>
        </div>
      </div>

      <div className="filter-pills-row">
        <button
          className={`pill-btn ${currentPill === 'all' ? 'active' : ''}`}
          onClick={() => setPill('all')}
        >
          All Games ({totalGames})
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
      </div>
    </div>
  );
};
