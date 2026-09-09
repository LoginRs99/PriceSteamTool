import { describe, it, expect } from 'vitest';
import { 
  getSteamHeaderUrl, 
  getSteamCapsuleUrl, 
  getGameCoverCandidates 
} from '../../src/client/src/utils/steamImages.js';

describe('Steam Image Resolution Utility', () => {
  describe('getSteamHeaderUrl', () => {
    it('generates the Cloudflare CDN header URL for a given appId', () => {
      expect(getSteamHeaderUrl(1091500)).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg'
      );
      expect(getSteamHeaderUrl(730)).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/730/header.jpg'
      );
    });
  });

  describe('getSteamCapsuleUrl', () => {
    it('generates medium capsule url by default (231x87)', () => {
      expect(getSteamCapsuleUrl(1091500)).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_231x87.jpg'
      );
    });

    it('generates large capsule url (616x353)', () => {
      expect(getSteamCapsuleUrl(1091500, 'large')).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_616x353.jpg'
      );
    });

    it('generates small capsule url (sm_120)', () => {
      expect(getSteamCapsuleUrl(1091500, 'small')).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_sm_120.jpg'
      );
    });
  });

  describe('getGameCoverCandidates', () => {
    it('provides multi-tier fallback candidates for a standard game with appId', () => {
      const candidates = getGameCoverCandidates({
        steamAppId: 1091500
      });

      expect(candidates.length).toBeGreaterThanOrEqual(4);
      expect(candidates[0]).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg'
      );
      expect(candidates[1]).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_616x353.jpg'
      );
      expect(candidates[2]).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_231x87.jpg'
      );
      expect(candidates[candidates.length - 1]).toBe(
        'https://cdn.akamai.steamstatic.com/steam/apps/1091500/header.jpg'
      );
    });

    it('prioritizes high-res custom headerImage when clean and valid', () => {
      const customUrl = 'https://custom-cdn.com/game-art/witcher3.jpg';
      const candidates = getGameCoverCandidates({
        steamAppId: 292030,
        headerImage: customUrl
      });

      expect(candidates[0]).toBe(customUrl);
      expect(candidates).toContain(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/292030/header.jpg'
      );
    });

    it('filters out tiny thumbnail capsule_sm_120 from header candidates', () => {
      const tinyUrl = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_sm_120.jpg';
      const candidates = getGameCoverCandidates({
        steamAppId: 1091500,
        headerImage: tinyUrl
      });

      expect(candidates[0]).not.toBe(tinyUrl);
      expect(candidates[0]).toBe(
        'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg'
      );
    });

    it('deduplicates URLs if capsuleImage matches one of the generated ones', () => {
      const capsuleUrl = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1091500/capsule_231x87.jpg';
      const candidates = getGameCoverCandidates({
        steamAppId: 1091500,
        capsuleImage: capsuleUrl
      });

      const count = candidates.filter(u => u === capsuleUrl).length;
      expect(count).toBe(1);
    });

    it('returns empty array or custom images when steamAppId is 0 or negative', () => {
      const candidates = getGameCoverCandidates({
        steamAppId: 0
      });

      expect(candidates).toEqual([]);

      const customOnly = getGameCoverCandidates({
        steamAppId: -1,
        headerImage: 'https://example.com/custom.jpg'
      });

      expect(customOnly).toEqual(['https://example.com/custom.jpg']);
    });
  });
});
