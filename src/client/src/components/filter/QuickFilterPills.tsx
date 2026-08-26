import React from 'react';
import type { WishlistFilterOptions } from '../../types.js';
import { 
  Flame, 
  Sparkles, 
  ShieldCheck, 
  Tag, 
  RotateCcw 
} from 'lucide-react';

interface QuickFilterPillsProps {
  filters: WishlistFilterOptions;
  totalGames: number;
  isFiltered: boolean;
  onPillSelect: (pill: string) => void;
  onResetAll: () => void;
}

export const getActivePill = (filters: WishlistFilterOptions): string => {
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

export const QuickFilterPills: React.FC<QuickFilterPillsProps> = ({
  filters,
  totalGames,
  isFiltered,
  onPillSelect,
  onResetAll
}) => {
  const currentPill = getActivePill(filters);

  return (
    <div className="filter-pills-row">
      <button
        className={`pill-btn ${currentPill === 'all' && !isFiltered ? 'active' : ''}`}
        onClick={() => onPillSelect('all')}
      >
        All Games ({totalGames})
      </button>

      <button
        className={`pill-btn ${currentPill === 'buy_recommendations' ? 'active' : ''}`}
        onClick={() => onPillSelect('buy_recommendations')}
        style={{ borderColor: currentPill === 'buy_recommendations' ? '#10b981' : undefined }}
      >
        <Sparkles size={13} color="#10b981" />
        <span style={{ color: currentPill === 'buy_recommendations' ? '#10b981' : undefined, fontWeight: 700 }}>
          🔥 Buy Recommendations
        </span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'best_deals' ? 'active' : ''}`}
        onClick={() => onPillSelect('best_deals')}
      >
        <Sparkles size={13} />
        <span>Great Deals (70+)</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'exceptional' ? 'active' : ''}`}
        onClick={() => onPillSelect('exceptional')}
      >
        🔥 Exceptional (85+)
      </button>

      <button
        className={`pill-btn ${currentPill === 'atl' ? 'active' : ''}`}
        onClick={() => onPillSelect('atl')}
      >
        <Flame size={13} />
        <span>All-Time Low</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'sale' ? 'active' : ''}`}
        onClick={() => onPillSelect('sale')}
      >
        <Tag size={13} />
        <span>On Sale</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'discount_50' ? 'active' : ''}`}
        onClick={() => onPillSelect('discount_50')}
      >
        <span>-50%+ Off</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'discount_75' ? 'active' : ''}`}
        onClick={() => onPillSelect('discount_75')}
      >
        <span>-75%+ Off</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'under_5' ? 'active' : ''}`}
        onClick={() => onPillSelect('under_5')}
      >
        Under €5
      </button>

      <button
        className={`pill-btn ${currentPill === 'under_10' ? 'active' : ''}`}
        onClick={() => onPillSelect('under_10')}
      >
        Under €10
      </button>

      <button
        className={`pill-btn ${currentPill === 'under_20' ? 'active' : ''}`}
        onClick={() => onPillSelect('under_20')}
      >
        Under €20
      </button>

      <button
        className={`pill-btn ${currentPill === 'official' ? 'active' : ''}`}
        onClick={() => onPillSelect('official')}
      >
        <ShieldCheck size={13} />
        <span>Official Only</span>
      </button>

      <button
        className={`pill-btn ${currentPill === 'keyshop' ? 'active' : ''}`}
        onClick={() => onPillSelect('keyshop')}
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
          onClick={onResetAll}
          title="Reset all filters and search"
        >
          <RotateCcw size={12} />
          <span>Reset filters</span>
        </button>
      )}
    </div>
  );
};
