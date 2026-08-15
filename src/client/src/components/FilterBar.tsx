import React from 'react';
import type { WishlistFilterOptions } from '../types.js';
import { Search } from 'lucide-react';

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
    : filters.historicalLowOnly 
    ? 'historical_low'
    : filters.underPrice === 5
    ? 'under_5'
    : filters.underPrice === 10
    ? 'under_10'
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
          historicalLowOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'sale':
        onFilterChange({
          saleOnly: true,
          historicalLowOnly: false,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'historical_low':
        onFilterChange({
          saleOnly: false,
          historicalLowOnly: true,
          underPrice: undefined,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_10':
        onFilterChange({
          saleOnly: false,
          historicalLowOnly: false,
          underPrice: 10,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'under_5':
        onFilterChange({
          saleOnly: false,
          historicalLowOnly: false,
          underPrice: 5,
          merchantType: 'all',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'official':
        onFilterChange({
          saleOnly: false,
          historicalLowOnly: false,
          underPrice: undefined,
          merchantType: 'official',
          hasAnomaly: false,
          page: 1
        });
        break;
      case 'anomaly':
        onFilterChange({
          saleOnly: false,
          historicalLowOnly: false,
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

        <select
          className="select-input"
          value={filters.sort || 'priority'}
          onChange={(e) => onFilterChange({ sort: e.target.value as any, page: 1 })}
        >
          <option value="priority">Sort: Wishlist Priority</option>
          <option value="price_asc">Sort: Price (Lowest first)</option>
          <option value="price_desc">Sort: Price (Highest first)</option>
          <option value="discount_desc">Sort: Discount % (Highest first)</option>
          <option value="historical_low">Sort: Closest to Historical Low</option>
          <option value="title_asc">Sort: Title (A - Z)</option>
        </select>
      </div>

      <div className="filter-pills-row">
        <button
          className={`pill-btn ${currentPill === 'all' ? 'active' : ''}`}
          onClick={() => setPill('all')}
        >
          All Games ({totalGames})
        </button>

        <button
          className={`pill-btn ${currentPill === 'sale' ? 'active' : ''}`}
          onClick={() => setPill('sale')}
        >
          🏷️ On Sale
        </button>

        <button
          className={`pill-btn ${currentPill === 'historical_low' ? 'active' : ''}`}
          onClick={() => setPill('historical_low')}
        >
          🔥 Historical Low
        </button>

        <button
          className={`pill-btn ${currentPill === 'under_10' ? 'active' : ''}`}
          onClick={() => setPill('under_10')}
        >
          Under €10
        </button>

        <button
          className={`pill-btn ${currentPill === 'under_5' ? 'active' : ''}`}
          onClick={() => setPill('under_5')}
        >
          Under €5
        </button>

        <button
          className={`pill-btn ${currentPill === 'official' ? 'active' : ''}`}
          onClick={() => setPill('official')}
        >
          🛡️ Official Stores Only
        </button>

        <button
          className={`pill-btn ${currentPill === 'anomaly' ? 'active' : ''}`}
          onClick={() => setPill('anomaly')}
        >
          ⚠ Anomalies
        </button>
      </div>
    </div>
  );
};
