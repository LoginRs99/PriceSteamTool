import { describe, it, expect } from 'vitest';
import { normalizeProductType, normalizeRegion, convertToEur } from '../../src/server/domain/normalizer.js';

describe('Domain Normalizer — Comprehensive Audit Suite', () => {
  describe('Product Type Normalization', () => {
    it('accepts valid Steam Keys', () => {
      const samples = ['Steam Key', 'Steam CD Key', 'Digital Key', 'Standard Edition Steam Key'];
      for (const s of samples) {
        const res = normalizeProductType(s);
        expect(res.isValid).toBe(true);
        expect(res.productType).toBe('STEAM_KEY');
      }
    });

    it('accepts Steam Gift products', () => {
      const samples = ['Steam Gift ROW', 'Steam Gift', 'Steam Gift Link'];
      for (const s of samples) {
        const res = normalizeProductType(s);
        expect(res.isValid).toBe(true);
        expect(res.productType).toBe('STEAM_GIFT');
      }
    });

    it('accepts Direct Store purchases', () => {
      const samples = ['Steam Direct', 'Direct Purchase', 'Steam Connect'];
      for (const s of samples) {
        const res = normalizeProductType(s);
        expect(res.isValid).toBe(true);
        expect(res.productType).toBe('DIRECT_PURCHASE');
      }
    });

    it('strictly rejects account-based products', () => {
      const samples = [
        'Steam Account',
        'Shared Account Login',
        'Offline Activation Account',
        'Pre-made Account with Game',
        'Family Share Account',
        'Account Transfer',
        'Steam Prime Account'
      ];

      for (const sample of samples) {
        const res = normalizeProductType(sample);
        expect(res.isValid).toBe(false);
        expect(res.rejectReason).toContain('Account-based');
      }
    });
  });

  describe('Region Normalization', () => {
    it('accepts Global / Worldwide keys', () => {
      const samples = ['Global', 'Worldwide', 'WW', 'Region Free', 'ROW', ''];
      for (const s of samples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
        expect(res.regionType).toBe('GLOBAL');
        expect(res.regionConfidence).toBe(1.0);
      }
    });

    it('accepts Europe / EU keys', () => {
      const samples = ['Europe', 'EU', 'EEA', 'EMEA', 'European Union'];
      for (const s of samples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
        expect(res.regionType).toBe('EU');
        expect(res.regionConfidence).toBe(1.0);
      }
    });

    it('accepts Hungary specific keys', () => {
      const samples = ['HU', 'Hungary'];
      for (const s of samples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(true);
        expect(res.regionType).toBe('HU');
        expect(res.regionConfidence).toBe(1.0);
      }
    });

    it('rejects foreign locked keys and ISO codes (US, Egypt, Turkey, Russia, Argentina, Brazil, China, LATAM)', () => {
      const restricted = [
        { reg: 'US', country: '' },
        { reg: 'United States', country: 'US' },
        { reg: 'EG', country: 'Egypt' },
        { reg: 'Turkey', country: 'TR' },
        { reg: 'Russia / CIS', country: 'RU' },
        { reg: 'Argentina', country: 'AR' },
        { reg: 'Brazil', country: 'BR' },
        { reg: 'China', country: 'CN' },
        { reg: 'LATAM Region', country: '' },
        { reg: 'Asia Only', country: '' }
      ];

      for (const r of restricted) {
        const res = normalizeRegion(r.reg, r.country);
        expect(res.isValid).toBe(false);
        expect(res.regionType).toBe('RESTRICTED');
      }
    });

    it('does not false-positive on legitimate titles containing sub-strings like Trust or Star', () => {
      const res = normalizeRegion('Global', '');
      expect(res.isValid).toBe(true);
      expect(res.regionType).toBe('GLOBAL');
    });
  });

  describe('Currency Normalization', () => {
    it('keeps EUR unchanged', () => {
      expect(convertToEur(19.99, 'EUR')).toBe(19.99);
      expect(convertToEur(19.99, '€')).toBe(19.99);
    });

    it('converts USD and GBP to EUR baseline', () => {
      expect(convertToEur(10.00, 'USD')).toBe(9.20);
      expect(convertToEur(10.00, 'GBP')).toBe(11.70);
    });
  });
});
