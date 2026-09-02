// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealsDashboard } from '../../src/client/src/components/DealsDashboard.js';
import type { Game, WishlistStatistics } from '../../src/client/src/types.js';

const mockStats: WishlistStatistics = {
  totalGames: 10,
  gamesOnSale: 6,
  gamesAtHistoricalLow: 3,
  majorDropsCount: 2,
  gamesWithHighRiskOffers: 1,
  freeGamesCount: 2,
  averageDiscountPercent: 45
};

const mockTopDeal: Game = {
  id: 'deal-1',
  steamAppId: 105600,
  title: 'Terraria',
  slug: 'terraria',
  isDlc: false,
  isFree: false,
  hasAnomaly: false,
  offersCount: 3,
  basePriceEur: 9.99,
  bestPriceEur: 4.99,
  bestDiscountPercent: 50,
  bestDealScore: 88,
  bestDealTier: 'Great',
  bestConfidenceScore: 92,
  bestMerchantName: 'Steam Store',
  bestMerchantIsOfficial: true,
  bestDealUrl: 'https://store.steampowered.com/app/105600',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

describe('DealsDashboard Component', () => {
  it('renders null when stats is null and topDeals is empty', () => {
    const { container } = render(
      <DealsDashboard
        stats={null}
        topDeals={[]}
        onSelectGame={() => {}}
        onFilterATL={() => {}}
        onFilterMajor={() => {}}
        onFilterSale={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders statistics cards and fires filter callbacks when clicked', () => {
    const filterSaleMock = vi.fn();
    const filterAtlMock = vi.fn();
    const filterMajorMock = vi.fn();

    render(
      <DealsDashboard
        stats={mockStats}
        topDeals={[]}
        onSelectGame={() => {}}
        onFilterATL={filterAtlMock}
        onFilterMajor={filterMajorMock}
        onFilterSale={filterSaleMock}
      />
    );

    expect(screen.getByText('On Sale')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('All-Time Lows')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Mega & Major Deals')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('On Sale').closest('.stat-card')!);
    expect(filterSaleMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('All-Time Lows').closest('.stat-card')!);
    expect(filterAtlMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Mega & Major Deals').closest('.stat-card')!);
    expect(filterMajorMock).toHaveBeenCalledTimes(1);
  });

  it('renders top deals carousel and fires onSelectGame when a deal card is clicked', () => {
    const selectGameMock = vi.fn();

    render(
      <DealsDashboard
        stats={mockStats}
        topDeals={[mockTopDeal]}
        onSelectGame={selectGameMock}
        onFilterATL={() => {}}
        onFilterMajor={() => {}}
        onFilterSale={() => {}}
      />
    );

    expect(screen.getByText('Terraria')).toBeInTheDocument();
    expect(screen.getByText('€4.99')).toBeInTheDocument();
    expect(screen.getByText('-50%')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Terraria').closest('.spotlight-card')!);
    expect(selectGameMock).toHaveBeenCalledWith('deal-1');
  });
});
