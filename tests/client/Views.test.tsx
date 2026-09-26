// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CompactListView } from '../../src/client/src/components/CompactListView.js';
import { FreeGamesView } from '../../src/client/src/components/FreeGamesView.js';
import type { Game } from '../../src/client/src/types.js';

const mockPaidGame: Game = {
  id: 'game-1',
  steamAppId: 105600,
  title: 'Terraria',
  slug: 'terraria',
  isDlc: false,
  isFree: false,
  hasPricingError: false,
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
};

const mockFreeGame: Game = {
  id: 'free-1',
  steamAppId: 570,
  title: 'Dota 2',
  slug: 'dota-2',
  isDlc: false,
  isFree: true,
  hasPricingError: false,
  offersCount: 1,
  basePriceEur: 0,
  bestPriceEur: 0,
  bestMerchantName: 'Steam',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

describe('Catalog Views: CompactListView and FreeGamesView', () => {

  describe('CompactListView', () => {
    it('renders compact rows with badges, scores, prices and handles game click and refresh', async () => {
      const clickMock = vi.fn();
      const explainMock = vi.fn();
      const refreshMock = vi.fn();

      render(
        <CompactListView
          games={[mockPaidGame]}
          onGameClick={clickMock}
          onExplain={explainMock}
          onRefreshGame={refreshMock}
        />
      );

      expect(screen.getByText('Terraria')).toBeInTheDocument();
      expect(screen.getByText('€4.99')).toBeInTheDocument();
      expect(screen.getAllByText('-50%').length).toBeGreaterThan(0);
      expect(screen.getByText('€9.99')).toBeInTheDocument();
      expect(screen.getByText(/85/)).toBeInTheDocument(); // Deal score badge
      expect(screen.getByText('Steam Store')).toBeInTheDocument();

      // Click row
      fireEvent.click(screen.getByText('Terraria'));
      expect(clickMock).toHaveBeenCalledWith(mockPaidGame);

      // Click score badge to explain
      fireEvent.click(screen.getByText(/85/));
      expect(explainMock).toHaveBeenCalledWith(mockPaidGame);

      // Click refresh button
      const refreshBtn = screen.getByTitle('Refresh price from all sources');
      await act(async () => {
        fireEvent.click(refreshBtn);
      });
      expect(refreshMock).toHaveBeenCalledWith('game-1');
    });

    it('renders empty message when no games provided', () => {
      render(
        <CompactListView
          games={[]}
          onGameClick={vi.fn()}
        />
      );

      expect(screen.getByText('No games to display in compact view.')).toBeInTheDocument();
    });
  });

  describe('FreeGamesView', () => {
    it('renders free games banner, filters by search query, and handles interactions', () => {
      const gameClickMock = vi.fn();

      render(
        <FreeGamesView
          games={[mockFreeGame]}
          onGameClick={gameClickMock}
        />
      );

      expect(screen.getByText('Free-to-Play & Free Wishlist Titles')).toBeInTheDocument();
      expect(screen.getByText('Dota 2')).toBeInTheDocument();

      // Test Search Filter
      const searchInput = screen.getByPlaceholderText('Search free games...');
      fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });
      expect(screen.queryByText('Dota 2')).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: 'Dota' } });
      expect(screen.getByText('Dota 2')).toBeInTheDocument();

      // Click game row
      fireEvent.click(screen.getByText('Dota 2'));
      expect(gameClickMock).toHaveBeenCalledWith(mockFreeGame);
    });
  });
});
