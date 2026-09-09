import { useEffect, useRef } from 'react';
import type { WishlistFilterOptions } from '../../types.js';
import { getActivePill } from './QuickFilterPills.js';

export const QUICK_PILL_BASE: Partial<WishlistFilterOptions> = {
  buyOnly: false,
  targetReachedOnly: false,
  saleOnly: false,
  majorDealsOnly: false,
  allTimeLowOnly: false,
  trustedOnly: false,
  underPrice: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  minDiscount: undefined,
  minDealScore: undefined,
  merchantType: 'all',
  hasAnomaly: false,
  page: 1
};

export function useFilterState(
  filters: WishlistFilterOptions,
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void
) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (filters.search) {
          onFilterChange({ search: '', page: 1 });
        }
        searchInputRef.current?.blur();
        return;
      }

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
  }, [filters.search, onFilterChange]);

  // Calculate active filter count for badge
  let activeFilterCount = 0;
  if (filters.search) activeFilterCount++;
  if (filters.buyOnly) activeFilterCount++;
  if (filters.targetReachedOnly) activeFilterCount++;
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
  if (filters.hideUnreleased) activeFilterCount++;
  if (filters.hideDlcs) activeFilterCount++;
  if (filters.includeFreeGames) activeFilterCount++;
  if (filters.hideFamilyShared) activeFilterCount++;

  const isFiltered = Boolean(activeFilterCount > 0 || (filters.sort && filters.sort !== 'best_value'));

  const resetAllFilters = () => {
    onFilterChange({
      search: '',
      sort: 'best_value',
      saleOnly: false,
      majorDealsOnly: false,
      allTimeLowOnly: false,
      targetReachedOnly: false,
      trustedOnly: false,
      underPrice: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minDiscount: undefined,
      minDealScore: undefined,
      hideAnomalies: false,
      hideProvisional: false,
      hideUnreleased: false,
      hideDlcs: false,
      includeFreeGames: false,
      hideFamilyShared: false,
      buyOnly: false,
      merchantType: 'all',
      hasAnomaly: false,
      page: 1
    });
  };

  const setPill = (pill: string) => {
    const currentActive = getActivePill(filters);

    // If clicking the already active pill, toggle it off back to all games
    if (pill === currentActive && pill !== 'all') {
      onFilterChange({
        ...QUICK_PILL_BASE,
        sort: 'best_value'
      });
      return;
    }

    switch (pill) {
      case 'all':
        onFilterChange({
          ...QUICK_PILL_BASE,
          sort: 'best_value'
        });
        break;
      case 'buy_recommendations':
        onFilterChange({
          ...QUICK_PILL_BASE,
          buyOnly: true,
          minDealScore: 70,
          sort: 'best_value'
        });
        break;
      case 'target_reached':
        onFilterChange({
          ...QUICK_PILL_BASE,
          targetReachedOnly: true,
          sort: 'best_value'
        });
        break;
      case 'best_deals':
        onFilterChange({
          ...QUICK_PILL_BASE,
          minDealScore: 70,
          sort: 'best_value'
        });
        break;
      case 'exceptional':
        onFilterChange({
          ...QUICK_PILL_BASE,
          minDealScore: 85,
          sort: 'deal_score_desc'
        });
        break;
      case 'discount_75':
        onFilterChange({
          ...QUICK_PILL_BASE,
          minDiscount: 75,
          saleOnly: true,
          sort: 'price_drops'
        });
        break;
      case 'discount_50':
        onFilterChange({
          ...QUICK_PILL_BASE,
          minDiscount: 50,
          saleOnly: true,
          sort: 'price_drops'
        });
        break;
      case 'atl':
        onFilterChange({
          ...QUICK_PILL_BASE,
          allTimeLowOnly: true,
          sort: 'near_atl'
        });
        break;
      case 'sale':
        onFilterChange({
          ...QUICK_PILL_BASE,
          saleOnly: true,
          sort: 'price_drops'
        });
        break;
      case 'under_5':
        onFilterChange({
          ...QUICK_PILL_BASE,
          underPrice: 5,
          maxPrice: 5,
          sort: 'price_asc'
        });
        break;
      case 'under_10':
        onFilterChange({
          ...QUICK_PILL_BASE,
          underPrice: 10,
          maxPrice: 10,
          sort: 'price_asc'
        });
        break;
      case 'under_20':
        onFilterChange({
          ...QUICK_PILL_BASE,
          underPrice: 20,
          maxPrice: 20,
          sort: 'price_asc'
        });
        break;
      case 'official':
        onFilterChange({
          ...QUICK_PILL_BASE,
          merchantType: 'official',
          sort: 'best_value'
        });
        break;
      case 'keyshop':
        onFilterChange({
          ...QUICK_PILL_BASE,
          merchantType: 'keyshop',
          sort: 'best_value'
        });
        break;
    }
  };

  return {
    searchInputRef,
    activeFilterCount,
    isFiltered,
    resetAllFilters,
    setPill
  };
}
