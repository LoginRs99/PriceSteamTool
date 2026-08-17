import { describe, it, expect } from 'vitest';
import { parseItadProductAndOfficial } from '../../src/server/sources/itad.js';
import { normalizeProductType } from '../../src/server/domain/normalizer.js';

describe('ITAD Source Adapter — DRM & Merchant Classification', () => {
  it('correctly classifies "Epic Game Store" as non-Steam with isOfficial = false', () => {
    const res = parseItadProductAndOfficial('Epic Game Store', []);
    expect(res.productTypeRaw).toBe('Epic Game Store (Non-Steam)');
    expect(res.isOfficial).toBe(false);

    // Normalizer must reject this from entering Steam deals
    const norm = normalizeProductType(res.productTypeRaw);
    expect(norm.isValid).toBe(false);
    expect(norm.rejectReason).toContain('Non-Steam');
  });

  it('correctly classifies "Epic Games" and other known non-Steam launchers', () => {
    const nonSteamStores = [
      'Epic Games',
      'GOG',
      'Ubisoft Store',
      'EA App',
      'Battle.net',
      'Microsoft Store',
      'Xbox'
    ];

    for (const shop of nonSteamStores) {
      const res = parseItadProductAndOfficial(shop, []);
      expect(res.productTypeRaw).toContain('(Non-Steam)');
      expect(res.isOfficial).toBe(false);

      const norm = normalizeProductType(res.productTypeRaw);
      expect(norm.isValid).toBe(false);
    }
  });

  it('correctly classifies explicit non-Steam DRM array', () => {
    const res = parseItadProductAndOfficial('Random Store', ['Epic', 'GOG']);
    expect(res.productTypeRaw).toBe('Epic, GOG (Non-Steam)');
    expect(res.isOfficial).toBe(false);

    const norm = normalizeProductType(res.productTypeRaw);
    expect(norm.isValid).toBe(false);
  });

  it('correctly classifies known authorized Steam key retailers as official Steam Keys', () => {
    const steamKeyStores = [
      'Humble Store',
      'Fanatical',
      'Green Man Gaming',
      'GameBillet',
      'IndieGala',
      'WinGameStore',
      'GamersGate',
      'Gamesplanet US',
      'DLGamer',
      'JoyBuggy',
      'DreamGame',
      '2Game',
      'Voidu',
      'Nuuvem'
    ];

    for (const shop of steamKeyStores) {
      const res = parseItadProductAndOfficial(shop, []);
      expect(res.productTypeRaw).toBe('Steam Key');
      expect(res.isOfficial).toBe(true);

      const norm = normalizeProductType(res.productTypeRaw);
      expect(norm.isValid).toBe(true);
      expect(norm.productType).toBe('STEAM_KEY');
    }
  });

  it('correctly classifies Direct Steam purchases', () => {
    const res = parseItadProductAndOfficial('Steam Store', []);
    expect(res.productTypeRaw).toBe('Direct Purchase');
    expect(res.isOfficial).toBe(true);

    const norm = normalizeProductType(res.productTypeRaw);
    expect(norm.isValid).toBe(true);
    expect(norm.productType).toBe('DIRECT_PURCHASE');
  });

  it('correctly classifies arbitrary store with explicit Steam DRM', () => {
    const res = parseItadProductAndOfficial('Boutique Keyshop', ['Steam']);
    expect(res.productTypeRaw).toBe('Steam Key');
    expect(res.isOfficial).toBe(true);

    const norm = normalizeProductType(res.productTypeRaw);
    expect(norm.isValid).toBe(true);
    expect(norm.productType).toBe('STEAM_KEY');
  });

  it('defaults unverified/unknown stores without Steam DRM to Unknown/Non-Steam with isOfficial = false', () => {
    const res = parseItadProductAndOfficial('Unverified Store', []);
    expect(res.productTypeRaw).toBe('Unknown/Non-Steam');
    expect(res.isOfficial).toBe(false);

    const norm = normalizeProductType(res.productTypeRaw);
    expect(norm.isValid).toBe(false);
  });
});
