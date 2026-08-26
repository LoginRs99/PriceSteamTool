// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompactListView } from '../../src/client/src/components/CompactListView.js';
import { DenseTableView } from '../../src/client/src/components/DenseTableView.js';
import { FreeGamesView } from '../../src/client/src/components/FreeGamesView.js';
import type { Game } from '../../src/client/src/types.js';

const mockPaidGame: Game = {
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
};

const mockFreeGame: Game = {
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
};

describe('Catalog Views: CompactListView, DenseTableView, and FreeGamesView', () => {
  describe('CompactListView', () => {
    it('renders compact list rows with titles, discounts, and triggers callbacks', () => {
      const clickMock = vi.fn();
      const explainMock = vi.fn();

      render(
        <CompactListView
          games={[mockPaidGame]}
          onGameClick={clickMock}
          onExplain={explainMock}
        />
      );

      expect(screen.getByText('Terraria')).toBeInTheDocument();
      expect(screen.getByText('€4.99')).toBeInTheDocument();
      expect(screen.getByText('-50%')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Terraria'));
      expect(clickMock).toHaveBeenCalledWith(mockPaidGame);

      const scoreBtn = screen.getByText(/85/);
      fireEvent.click(scoreBtn);
      expect(explainMock).toHaveBeenCalledWith(mockPaidGame);
    });
  });

  describe('DenseTableView', () => {
    it('renders table columns, sort changes, and row interactions', () => {
      const clickMock = vi.fn();
      const explainMock = vi.fn();
      const sortMock = vi.fn();

      render(
        <DenseTableView
          games={[mockPaidGame]}
          onGameClick={clickMock}
          onExplain={explainMock}
          currentSort="best_value"
          onSortChange={sortMock}
        />
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Deal Score')).toBeInTheDocument();
      expect(screen.getByText('Terraria')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Terraria'));
      expect(clickMock).toHaveBeenCalledWith(mockPaidGame);

      // Change sort by clicking Deal Score column header
      fireEvent.click(screen.getByText('Deal Score'));
      expect(sortMock).toHaveBeenCalled();
    });
  });

  describe('FreeGamesView', () => {
    it('renders free games banner, filters by search query, and changes view modes', () => {
      const viewModeMock = vi.fn();
      const gameClickMock = vi.fn();

      render(
        <FreeGamesView
          games={[mockFreeGame]}
          viewMode="grid"
          onViewModeChange={viewModeMock}
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

      // Switch View Mode
      const listBtn = screen.getByLabelText('Compact List View');
      fireEvent.click(listBtn);
      expect(viewModeMock).toHaveBeenCalledWith('list');
    });
  });
});
