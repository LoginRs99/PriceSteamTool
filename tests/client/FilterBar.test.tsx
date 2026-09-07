// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../../src/client/src/components/FilterBar.js';
import type { WishlistFilterOptions, ViewMode } from '../../src/client/src/types.js';

const defaultFilters: WishlistFilterOptions = {
  sort: 'best_value',
  page: 1,
  limit: 50
};

describe('FilterBar Component (Monolith & Decomposed Regression Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders search input, sort selector, and preset pills', () => {
    const handleFilterChange = vi.fn();

    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={142}
        onFilterChange={handleFilterChange}
      />
    );

    expect(screen.getByPlaceholderText('Search wishlist games... (press /)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort wishlist games' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Games (142)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buy Recommendations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Great Deals/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All-Time Low/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /On Sale/i })).toBeInTheDocument();
  });

  it('fires onFilterChange when typing in search input', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search wishlist games... (press /)');
    fireEvent.change(searchInput, { target: { value: 'Witcher' } });

    expect(handleFilterChange).toHaveBeenCalledWith({ search: 'Witcher', page: 1 });
  });

  it('clears search when clear button is clicked', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={{ ...defaultFilters, search: 'Cyberpunk' }}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const clearBtn = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clearBtn);

    expect(handleFilterChange).toHaveBeenCalledWith({ search: '', page: 1 });
  });

  it('fires onFilterChange when sort strategy is changed', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const sortSelect = screen.getByRole('combobox', { name: 'Sort wishlist games' });
    fireEvent.change(sortSelect, { target: { value: 'price_asc' } });

    expect(handleFilterChange).toHaveBeenCalledWith({ sort: 'price_asc', page: 1 });
  });

  it('sets appropriate filter options when clicking preset pills', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    // Click Buy Recommendations
    const buyRecsBtn = screen.getByRole('button', { name: /Buy Recommendations/i });
    fireEvent.click(buyRecsBtn);
    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      buyOnly: true,
      minDealScore: 70,
      page: 1
    }));

    // Click All-Time Low
    const atlBtn = screen.getByRole('button', { name: /All-Time Low/i });
    fireEvent.click(atlBtn);
    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      allTimeLowOnly: true,
      sort: 'near_atl',
      page: 1
    }));

    // Click Under €5
    const under5Btn = screen.getByRole('button', { name: 'Under €5' });
    fireEvent.click(under5Btn);
    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      underPrice: 5,
      maxPrice: 5,
      sort: 'price_asc',
      page: 1
    }));
  });

  it('toggles advanced filters drawer and updates deal score and price inputs', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    // Open Filters Drawer
    const filtersBtn = screen.getByRole('button', { name: /Filters/i });
    fireEvent.click(filtersBtn);

    expect(screen.getByText('Minimum Deal Score')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Min €')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Max €')).toBeInTheDocument();

    // Change Min €
    const minInput = screen.getByPlaceholderText('Min €');
    fireEvent.change(minInput, { target: { value: '15' } });
    expect(handleFilterChange).toHaveBeenCalledWith({ minPrice: 15, page: 1 });

    // Change Max €
    const maxInput = screen.getByPlaceholderText('Max €');
    fireEvent.change(maxInput, { target: { value: '45' } });
    expect(handleFilterChange).toHaveBeenCalledWith({ maxPrice: 45, page: 1 });

    // Toggle Hide Anomalies checkbox
    const hideAnomaliesCheckbox = screen.getByRole('checkbox', { name: 'Hide High-Risk Anomalies' });
    fireEvent.click(hideAnomaliesCheckbox);
    expect(handleFilterChange).toHaveBeenCalledWith({ hideAnomalies: true, page: 1 });
  });

  it('resets all filters when Reset filters / Clear all is clicked', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={{
          ...defaultFilters,
          search: 'query',
          allTimeLowOnly: true,
          minDealScore: 80,
          merchantType: 'official'
        }}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const resetBtn = screen.getByRole('button', { name: 'Reset filters' });
    fireEvent.click(resetBtn);

    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      search: '',
      sort: 'best_value',
      allTimeLowOnly: false,
      minDealScore: undefined,
      merchantType: 'all',
      page: 1
    }));
  });

  it('triggers targetReachedOnly when clicking Target Reached pill', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={defaultFilters}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const targetBtn = screen.getByRole('button', { name: /Target Reached/i });
    fireEvent.click(targetBtn);
    expect(handleFilterChange).toHaveBeenCalledWith(expect.objectContaining({
      targetReachedOnly: true,
      page: 1
    }));
  });

  it('clears search when pressing Escape while search input is focused', () => {
    const handleFilterChange = vi.fn();
    render(
      <FilterBar 
        filters={{ ...defaultFilters, search: 'Witcher' }}
        totalGames={100}
        onFilterChange={handleFilterChange}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search wishlist games... (press /)');
    searchInput.focus();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(handleFilterChange).toHaveBeenCalledWith({ search: '', page: 1 });
  });
});
