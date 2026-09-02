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

    it('strictly rejects non-Steam platforms (GOG, Epic, Origin, Ubisoft, Blizzard, DRM-Free)', () => {
      const samples = [
        'GOG Key',
        'GOG.com DRM-Free',
        'Epic Games Store Key',
        'Epic Games',
        'Origin / EA App Key',
        'Ubisoft Connect Key',
        'Uplay Digital Code',
        'Battle.net Key',
        'Blizzard Key',
        'Rockstar Games Launcher Key',
        'Microsoft Store Key',
        'Xbox Live Key',
        'Nintendo Switch Digital Code',
        'DRM-Free Download'
      ];

      for (const sample of samples) {
        const res = normalizeProductType(sample);
        expect(res.isValid).toBe(false);
        expect(res.rejectReason).toContain('Non-Steam platform excluded');
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

    it('strictly rejects unknown or ambiguous region strings to prevent surfacing invalid keys', () => {
      const unknownSamples = ['Asia Pacific', 'Sub-Saharan Africa', 'Japan Only', 'South Korea Key', 'XYZ-Unknown'];
      for (const s of unknownSamples) {
        const res = normalizeRegion(s);
        expect(res.isValid).toBe(false);
        expect(res.regionType).toBe('RESTRICTED');
      }
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

  describe('Game Title & Roman Numeral Normalization', () => {
    it('canonicalizes Roman numerals to digits', async () => {
      const { normalizeGameTitle } = await import('../../src/server/domain/normalizer.js');
      expect(normalizeGameTitle('Final Fantasy VII Remake')).toBe('finalfantasy7');
      expect(normalizeGameTitle('Grand Theft Auto V')).toBe('grandtheftauto5');
      expect(normalizeGameTitle('The Witcher III: Wild Hunt')).toBe('thewitcher3wildhunt');
      expect(normalizeGameTitle('Resident Evil VIII: Village')).toBe('residentevil8village');
    });

    it('strips trademarks, symbols, and edition tags safely without exceptions', async () => {
      const { normalizeGameTitle } = await import('../../src/server/domain/normalizer.js');
      expect(normalizeGameTitle('DOOM® Eternal™ (Deluxe Edition)')).toBe('doometernal');
      expect(normalizeGameTitle('Borderlands: Game of the Year Edition')).toBe('borderlands');
      expect(normalizeGameTitle('The Elder Scrolls V: Skyrim - Special Edition')).toBe('theelderscrolls5skyrim');
      expect(normalizeGameTitle(null as any)).toBe('');
      expect(normalizeGameTitle(undefined as any)).toBe('');
    });
  });
});

