import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DenseTableView } from '../../src/client/src/components/DenseTableView.js';
import { PriceChart } from '../../src/client/src/components/PriceChart.js';
import type { Game, PriceChartData } from '../../src/client/src/types.js';

describe('Task 25: Minor Polish (DenseTableView concurrent spinners & PriceChart tooltip)', () => {
  describe('DenseTableView concurrent row refreshing', () => {
    const mockGames: Game[] = [
      {
        id: 'game-1',
        steamAppId: 100,
        title: 'Game One',
        slug: 'game-one',
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      },
      {
        id: 'game-2',
        steamAppId: 200,
        title: 'Game Two',
        slug: 'game-two',
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      }
    ];

    it('supports concurrent row refreshes with independent spinners and disabled states', async () => {
      let resolveGame1: () => void;
      let resolveGame2: () => void;

      const p1 = new Promise<void>(resolve => {
        resolveGame1 = resolve;
      });
      const p2 = new Promise<void>(resolve => {
        resolveGame2 = resolve;
      });

      const onRefreshGame = vi.fn().mockImplementation((id: string) => {
        if (id === 'game-1') return p1;
        if (id === 'game-2') return p2;
        return Promise.resolve();
      });

      render(
        <DenseTableView 
          games={mockGames} 
          onGameClick={() => {}} 
          onRefreshGame={onRefreshGame} 
        />
      );

      const btn1 = screen.getByLabelText('Refresh prices for Game One');
      const btn2 = screen.getByLabelText('Refresh prices for Game Two');

      expect(btn1).not.toBeDisabled();
      expect(btn2).not.toBeDisabled();

      // Click refresh on Game 1
      await act(async () => {
        fireEvent.click(btn1);
      });

      expect(btn1).toBeDisabled();
      expect(btn1.querySelector('svg')).toHaveClass('spin-icon');
      expect(btn2).not.toBeDisabled();

      // Click refresh on Game 2 while Game 1 is still pending
      await act(async () => {
        fireEvent.click(btn2);
      });

      // BOTH should now be disabled and spinning concurrently
      expect(btn1).toBeDisabled();
      expect(btn1.querySelector('svg')).toHaveClass('spin-icon');
      expect(btn2).toBeDisabled();
      expect(btn2.querySelector('svg')).toHaveClass('spin-icon');

      // Resolve Game 1
      await act(async () => {
        resolveGame1!();
      });

      // Game 1 re-enabled, Game 2 still spinning
      expect(btn1).not.toBeDisabled();
      expect(btn1.querySelector('svg')).not.toHaveClass('spin-icon');
      expect(btn2).toBeDisabled();
      expect(btn2.querySelector('svg')).toHaveClass('spin-icon');

      // Resolve Game 2
      await act(async () => {
        resolveGame2!();
      });

      // Both re-enabled
      expect(btn1).not.toBeDisabled();
      expect(btn2).not.toBeDisabled();
    });
  });

  describe('PriceChart tooltip positioning', () => {
    const mockChartData: PriceChartData = {
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-02-01T00:00:00Z',
      basePriceEur: 60,
      historicalLowEur: 20,
      minPrice: 20,
      maxPrice: 60,
      points: [
        {
          priceEur: 50,
          timestamp: '2026-01-01T00:00:00Z',
          merchantName: 'Steam Store',
          isOfficial: true,
          discountPercent: 16
        },
        {
          priceEur: 30,
          timestamp: '2026-02-01T00:00:00Z',
          merchantName: 'Steam Store',
          isOfficial: true,
          discountPercent: 50
        }
      ]
    };

    it('positions tooltip using SVG getBoundingClientRect when available', async () => {
      // Mock getBoundingClientRect on SVGSVGElement
      vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 50,
        top: 100,
        right: 730,
        bottom: 340,
        width: 680,
        height: 240,
        x: 50,
        y: 100,
        toJSON: () => {}
      });

      const { container } = render(<PriceChart data={mockChartData} />);

      // Find interactive point group and trigger hover
      const pointCircles = container.querySelectorAll('circle[r="12"]');
      expect(pointCircles.length).toBeGreaterThan(0);

      await act(async () => {
        fireEvent.mouseEnter(pointCircles[0].parentElement!);
      });

      const tooltip = container.querySelector('.price-chart-tooltip');
      expect(tooltip).toBeInTheDocument();

      // Tooltip style should use calculated px positions
      expect((tooltip as HTMLElement).style.left).toMatch(/px$/);
      expect((tooltip as HTMLElement).style.top).toMatch(/px$/);
    });

    it('falls back to percentage positioning if SVG dimensions are 0 (e.g. unmeasured jsdom)', async () => {
      vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => {}
      });

      const { container } = render(<PriceChart data={mockChartData} />);

      const pointCircles = container.querySelectorAll('circle[r="12"]');
      await act(async () => {
        fireEvent.mouseEnter(pointCircles[0].parentElement!);
      });

      const tooltip = container.querySelector('.price-chart-tooltip');
      expect(tooltip).toBeInTheDocument();
      // Should fallback to % positioning
      expect((tooltip as HTMLElement).style.left).toMatch(/%$/);
      expect((tooltip as HTMLElement).style.top).toMatch(/%$/);
    });
  });
});
