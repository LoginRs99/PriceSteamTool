// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OffersTable } from '../../src/client/src/components/detail/OffersTable.js';
import type { Offer } from '../../src/client/src/types.js';

describe('OffersTable Component & Badge Integrity', () => {
  const sampleOffers: Offer[] = [
    {
      id: 'off-cjs',
      gameId: 'g-1',
      merchantId: 'm-cjs',
      merchantName: 'CJS CDKeys',
      merchantCode: 'cjs',
      isOfficial: false,
      priceEur: 5.37,
      originalPriceEur: 28.99,
      discountPercent: 81,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      dealUrl: 'https://cjs.com/deal',
      priceEvent: 'AT_HISTORICAL_LOW',
      riskLevel: 'SAFE',
      isBestDeal: true,
      isValid: true,
      isFresh: true,
      isAnomaly: false,
      dealScore: 82,
      dealTier: 'Great',
      sources: ['allkeyshop'],
      fetchedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'off-humble',
      gameId: 'g-1',
      merchantId: 'm-humble',
      merchantName: 'Humble Store',
      merchantCode: 'humble',
      isOfficial: true,
      priceEur: 12.94,
      originalPriceEur: 28.99,
      discountPercent: 50,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      dealUrl: 'https://humble.com/deal',
      priceEvent: 'AT_HISTORICAL_LOW', // Official store low, but 2.4x higher than CJS!
      riskLevel: 'SAFE',
      isBestDeal: false,
      isValid: true,
      isFresh: true,
      isAnomaly: false,
      dealScore: 60,
      dealTier: 'Good',
      sources: ['allkeyshop', 'itad'],
      fetchedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'off-ggdeals',
      gameId: 'g-1',
      merchantId: 'm-ggdeals',
      merchantName: 'GG.deals (Official)',
      merchantCode: 'ggdeals',
      isOfficial: true,
      priceEur: 14.49,
      originalPriceEur: 28.99,
      discountPercent: 50,
      productType: 'STEAM_KEY',
      regionType: 'EU',
      dealUrl: 'https://gg.deals/deal',
      priceEvent: 'MAJOR_DROP', // 50% drop vs MSRP, but 2.7x higher than CJS!
      riskLevel: 'SAFE',
      isBestDeal: false,
      isValid: true,
      isFresh: true,
      isAnomaly: false,
      dealScore: 50,
      dealTier: 'Fair',
      sources: ['ggdeals'],
      fetchedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'off-driffle-stale',
      gameId: 'g-1',
      merchantId: 'm-driffle',
      merchantName: 'Driffle',
      merchantCode: 'driffle',
      isOfficial: false,
      priceEur: 1.46,
      originalPriceEur: 28.99,
      discountPercent: 95,
      productType: 'STEAM_KEY',
      regionType: 'EU',
      dealUrl: 'https://driffle.com/deal',
      priceEvent: 'NONE',
      riskLevel: 'SAFE',
      isBestDeal: false,
      isValid: true,
      isFresh: false, // STALE! Out-of-stock from past scrape (>72h)
      isAnomaly: false,
      dealScore: 49,
      dealTier: 'Fair',
      sources: ['allkeyshop'],
      fetchedAt: '2026-08-01T00:00:00Z',
      lastObservedAt: '2026-08-01T00:00:00Z',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z'
    },
    {
      id: 'off-anomaly',
      gameId: 'g-1',
      merchantId: 'm-g2a',
      merchantName: 'G2A Seller X',
      merchantCode: 'g2a',
      isOfficial: false,
      priceEur: 0.49,
      originalPriceEur: 28.99,
      discountPercent: 98,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      dealUrl: 'https://g2a.com/deal',
      priceEvent: 'SUSPECTED_HISTORICAL_LOW',
      riskLevel: 'HIGH',
      isBestDeal: false,
      isValid: true,
      isFresh: true,
      isAnomaly: true,
      anomalyReason: 'Unconfirmed Record Drop • High Risk Anomaly',
      dealScore: 40,
      dealTier: 'Fair',
      sources: ['allkeyshop'],
      fetchedAt: new Date().toISOString(),
      lastObservedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  it('renders only active in-stock offers in main table and hides expired/stale offers', () => {
    render(
      <OffersTable
        offers={sampleOffers}
        copiedVoucherId={null}
        onCopyVoucher={() => {}}
      />
    );

    // Active count: 4 (CJS, Humble, GGdeals, Anomaly)
    expect(screen.getByText('Available Offers (4)')).toBeInTheDocument();

    // Expired toggle button is visible with count 1 (Driffle)
    expect(screen.getByText(/Show Expired \(1\)/)).toBeInTheDocument();

    // In the main active table, Driffle is NOT yet rendered
    expect(screen.queryByText('Driffle')).not.toBeInTheDocument();

    // Clicking toggle expands the expired section
    fireEvent.click(screen.getByText(/Show Expired \(1\)/));
    expect(screen.getByText('Driffle')).toBeInTheDocument();
    expect(screen.getByText('Expired / Out-of-Stock Prices (1)')).toBeInTheDocument();
  });

  it('suppresses misleading ATL and Major Drop badges on overpriced rows', () => {
    render(
      <OffersTable
        offers={sampleOffers}
        copiedVoucherId={null}
        onCopyVoucher={() => {}}
      />
    );

    // CJS at €5.37 is the Best Deal AND matches ATL -> MUST show both badges
    expect(screen.getByText('⭐ BEST OFFER')).toBeInTheDocument();
    expect(screen.getByText('🏆 ALL-TIME LOW')).toBeInTheDocument();

    // Count how many ALL-TIME LOW badges are rendered across the entire table
    // Must be EXACTLY 1 (for CJS) — Humble Store must NOT have an ALL-TIME LOW badge!
    const atlBadges = screen.getAllByText('🏆 ALL-TIME LOW');
    expect(atlBadges.length).toBe(1);

    // GG.deals at €14.49 (while CJS is €5.37) must NOT display MAJOR DROP badge
    expect(screen.queryByText('✨ MAJOR DROP')).not.toBeInTheDocument();
  });

  it('displays readable explanation for HIGH RISK anomaly offers', () => {
    render(
      <OffersTable
        offers={sampleOffers}
        copiedVoucherId={null}
        onCopyVoucher={() => {}}
      />
    );

    expect(screen.getByText('HIGH RISK')).toBeInTheDocument();
    expect(screen.getByText('Unverified outlier price (excluded from Best Deal)')).toBeInTheDocument();
  });
});
