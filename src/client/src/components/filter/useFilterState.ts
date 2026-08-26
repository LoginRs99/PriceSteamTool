import { useEffect, useRef } from 'react';
import type { WishlistFilterOptions } from '../../types.js';

export function useFilterState(
  filters: WishlistFilterOptions,
  onFilterChange: (newFilters: Partial<WishlistFilterOptions>) => void
) {
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const isFiltered = Boolean(activeFilterCount > 0 || (filters.sort && filters.sort !== 'best_value'));

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

  return {
    searchInputRef,
    activeFilterCount,
    isFiltered,
    resetAllFilters,
    setPill
  };
}
