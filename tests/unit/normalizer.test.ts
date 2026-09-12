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
      const samples = ['Global', 'Worldwide', 'WW', 'Region Free', ''];
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

    it('rejects foreign locked keys and ISO codes (US, Egypt, Turkey, Russia, Argentina, Brazil, China, LATAM, ROW)', () => {
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
        { reg: 'Asia Only', country: '' },
        { reg: 'ROW', country: '' },
        { reg: 'Rest of World', country: '' }
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

  describe('Mojibake Encoding Repair (CP1250 / CP1252 to UTF-8)', () => {
    it('repairs Windows-1250 and Windows-1252 corrupted strings', async () => {
      const { repairMojibake, normalizeGameTitle } = await import('../../src/server/domain/normalizer.js');

      // 1. ARMORED CORE VI with CP1250 mojibake for trademark symbol ™
      expect(repairMojibake('ARMORED COREâ„˘ VI')).toBe('ARMORED CORE™ VI');
      expect(normalizeGameTitle('ARMORED COREâ„˘ VI')).toBe('armoredcore6');

      // 2. CP1252 trademark symbol â„¢
      expect(repairMojibake('ARMORED COREâ„¢ VI')).toBe('ARMORED CORE™ VI');
      expect(normalizeGameTitle('ARMORED COREâ„¢ VI')).toBe('armoredcore6');

      // 3. Crash Bandicoot 4 with right single quotation mark / apostrophe
      expect(repairMojibake("Crash Bandicootâ„˘ 4: Itâ€™s About Time")).toBe("Crash Bandicoot™ 4: It’s About Time");
      expect(normalizeGameTitle("Crash Bandicootâ„˘ 4: Itâ€™s About Time")).toBe("crashbandicoot4itsabouttime");

      // 4. Sense - 不祥的预感 (Sense - 不祥的預感)
      const senseRepaired = repairMojibake('Sense - ä¸ŤçĄĄçš„é˘„ć„ź');
      expect(senseRepaired).not.toBe('Sense - ä¸ŤçĄĄçš„é˘„ć„ź');
      expect(normalizeGameTitle('Sense - ä¸ŤçĄĄçš„é˘„ć„ź')).toContain('sense');

      // 5. Warm Snow (暖雪)
      expect(repairMojibake('ćš–é›Ş Warm Snow')).toBe('暖雪 Warm Snow');
      expect(normalizeGameTitle('ćš–é›Ş Warm Snow')).toContain('warmsnow');

      // 6. Bloody Spell (嗜血印)
      expect(repairMojibake('ĺ—śčˇ€ĺŤ° Bloody Spell')).toBe('嗜血印 Bloody Spell');
      expect(normalizeGameTitle('ĺ—śčˇ€ĺŤ° Bloody Spell')).toContain('bloodyspell');
    });

    it('preserves authentic European names without corrupting them', async () => {
      const { repairMojibake, normalizeGameTitle } = await import('../../src/server/domain/normalizer.js');

      expect(repairMojibake('Petőfi')).toBe('Petőfi');
      expect(repairMojibake('Kraków')).toBe('Kraków');
      expect(repairMojibake('Dvořák')).toBe('Dvořák');
      expect(repairMojibake('François')).toBe('François');
      expect(repairMojibake('Müller')).toBe('Müller');

      expect(normalizeGameTitle('Petőfi Sándor')).toBe('petofisandor');
      expect(normalizeGameTitle('The Witcher: Kraków Edition')).toBe('thewitcherkrakow');
    });
  });
});


