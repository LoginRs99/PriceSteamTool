// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../src/client/src/App.js';
import { api } from '../../src/client/src/api.js';
import { MockEventSource } from '../setupClient.js';
import type { Profile, Game, WishlistStatistics } from '../../src/client/src/types.js';

const mockProfile: Profile = {
  id: 'prof-1',
  name: 'GamerGabe',
  steamId: '76561198000000001',
  customUrl: 'gabe',
  avatarUrl: 'https://steamcdn.com/avatar.jpg',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const mockGames: Game[] = [
  {
    id: 'game-1',
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
    bestDealScore: 85,
    bestDealTier: 'Great',
    bestConfidenceScore: 90,
    bestMerchantName: 'Steam Store',
    bestMerchantIsOfficial: true,
    bestDealUrl: 'https://store.steampowered.com/app/105600',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'game-2',
    steamAppId: 1091500,
    title: 'Cyberpunk 2077',
    slug: 'cyberpunk-2077',
    isDlc: false,
    isFree: false,
    hasAnomaly: false,
    offersCount: 4,
    basePriceEur: 59.99,
    bestPriceEur: 29.99,
    bestDiscountPercent: 50,
    bestDealScore: 78,
    bestDealTier: 'Good',
    bestConfidenceScore: 88,
    bestMerchantName: 'GOG',
    bestMerchantIsOfficial: true,
    bestDealUrl: 'https://gog.com/game/cyberpunk_2077',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
];

const mockStats: WishlistStatistics = {
  totalGames: 2,
  gamesOnSale: 2,
  gamesAtHistoricalLow: 1,
  majorDropsCount: 0,
  gamesWithHighRiskOffers: 0,
  freeGamesCount: 0,
  averageDiscountPercent: 50
};

describe('App Root Component (Monolith & Decomposed Regression Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    MockEventSource.instances = [];

    vi.spyOn(api, 'getProfiles').mockResolvedValue([mockProfile]);
    vi.spyOn(api, 'getWishlistGames').mockImplementation(async (opts: any) => {
      if (opts?.isFreeOnly) {
        return {
          games: [
            {
              id: 'free-1',
              steamAppId: 570,
              title: 'Dota 2',
              slug: 'dota-2',
              isDlc: false,
              isFree: true,
              hasAnomaly: false,
              offersCount: 1,
              basePriceEur: 0,
              bestPriceEur: 0,
              bestMerchantName: 'Steam',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z'
            }
          ],
          total: 1,
          activeProfile: mockProfile,
          page: 1,
          limit: 500,
          totalPages: 1
        };
      }
      return {
        games: mockGames,
        total: mockGames.length,
        activeProfile: mockProfile,
        page: 1,
        limit: 50,
        totalPages: 1
      };
    });
    vi.spyOn(api, 'getWishlistStatistics').mockResolvedValue(mockStats);
    vi.spyOn(api, 'getBestDeals').mockResolvedValue({
      deals: [mockGames[0]]
    });
    vi.spyOn(api, 'getAnomalies').mockResolvedValue([]);
    vi.spyOn(api, 'getGameDetails').mockResolvedValue({
      game: mockGames[0],
      offers: [],
      history: []
    });
    vi.spyOn(api, 'getPriceIntelligence').mockResolvedValue({
      gameId: 'game-1',
      currentPrice: { priceEur: 4.99, merchantName: 'Steam Store', isOfficial: true, discountPercent: 50 },
      historicalContextSummary: 'Matches ATL',
      chartData: { points: [], minPrice: 4.99, maxPrice: 9.99, startDate: '2026-01-01', endDate: '2026-01-02' },
      advice: { decision: 'BUY', confidence: 'HIGH', headline: 'Good Deal', reasoning: ['Verified low'] },
      periodLows: {
        low7d: { priceEur: 4.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 1 },
        low30d: { priceEur: 4.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 1 },
        low90d: { priceEur: 4.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 1 },
        low1y: { priceEur: 4.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 1 },
        allTimeLow: { priceEur: 4.99, isConfirmed: true, source: 'Steam' }
      },
      typicalSale: { medianPriceEur: 4.99, q1PriceEur: 4.99, q3PriceEur: 9.99, sampleCount: 2, isLowConfidence: false },
      frequency: { frequencyCategory: 'Frequent', saleEventsLast12m: 2 },
      volatility: { score: 90, category: 'Stable', priceChangesCount: 2, rawCv: 0.1 },
      marketComparison: { currentRank: 1, totalCompatibleOffers: 1, percentBelowMarketMedian: 0, marketMedianEur: 4.99 }
    });
  });

  it('renders empty state when no profile is configured', async () => {
    vi.spyOn(api, 'getProfiles').mockResolvedValue([]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('No Steam Profile Configured')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Add Steam Profile/i })).toBeInTheDocument();
  });

  it('loads active profile, wishlist games, and renders dashboard with game cards', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });

    expect(screen.getByText('Cyberpunk 2077')).toBeInTheDocument();
    expect(screen.getByText('Wishlist Deals')).toBeInTheDocument();
  });

  it('navigates between main tabs: Free to Play, Top Best Deals, and Data Safety', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });

    // 1. Switch to Free to Play tab
    const freeTab = screen.getByRole('button', { name: /Free to Play/i });
    await act(async () => {
      fireEvent.click(freeTab);
    });

    await waitFor(() => {
      expect(screen.getByText('Dota 2')).toBeInTheDocument();
    });

    // 2. Switch to Top Best Deals tab
    const dealsTab = screen.getByRole('button', { name: /Top Best Deals/i });
    await act(async () => {
      fireEvent.click(dealsTab);
    });

    await waitFor(() => {
      expect(screen.getByText('Top Ranked Deals (Best Value)')).toBeInTheDocument();
    });

    // 3. Switch to Data Safety tab
    const safetyTab = screen.getByRole('button', { name: /Data Safety/i });
    await act(async () => {
      fireEvent.click(safetyTab);
    });

    await waitFor(() => {
      expect(screen.getByText('Data Safety & Price Glitch Review')).toBeInTheDocument();
    });

    // 4. Return to Wishlist Deals
    const wishlistTab = screen.getByRole('button', { name: /Wishlist Deals/i });
    await act(async () => {
      fireEvent.click(wishlistTab);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });
  });

  it('switches view mode between grid, compact list, and dense table', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });

    // Switch to List View
    const listBtn = screen.getByLabelText(/Compact List View/i);
    fireEvent.click(listBtn);
    expect(localStorage.getItem('pricetool_view_mode')).toBe('list');

    // Switch to Table View
    const tableBtn = screen.getByLabelText(/Dense Table View/i);
    fireEvent.click(tableBtn);
    expect(localStorage.getItem('pricetool_view_mode')).toBe('table');

    // Switch back to Grid View
    const gridBtn = screen.getByLabelText(/Grid View/i);
    fireEvent.click(gridBtn);
    expect(localStorage.getItem('pricetool_view_mode')).toBe('grid');
  });

  it('opens GameDetailModal when a game is clicked and closes on close button', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });

    const terrariaCard = screen.getAllByText('Terraria')[0];
    await act(async () => {
      fireEvent.click(terrariaCard);
    });

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Steam Store (AppID: 105600)')).toBeInTheDocument();
    });

    const closeBtn = screen.getByLabelText('Close modal');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByLabelText('Close modal')).not.toBeInTheDocument();
    });
  });

  it('handles SSE sync progress updates and triggers data reload on COMPLETED event', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Terraria')[0]).toBeInTheDocument();
    });

    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    const es = MockEventSource.instances[0];

    // Emit RUNNING status
    await act(async () => {
      es.emitMessage({
        status: 'RUNNING',
        currentAction: 'Fetching ITAD deals...',
        percent: 45
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Fetching ITAD deals/i)).toBeInTheDocument();
    });

    const gamesSpy = vi.spyOn(api, 'getWishlistGames');

    // Emit COMPLETED status
    await act(async () => {
      es.emitMessage({
        status: 'COMPLETED',
        currentAction: 'Sync finished successfully!',
        percent: 100
      });
    });

    await waitFor(() => {
      expect(gamesSpy).toHaveBeenCalled();
    });
  });
});
