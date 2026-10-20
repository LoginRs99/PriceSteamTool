import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { 
  stripPublisherPrefixes,
  parseRetryAfterHeader,
  buildAksApiUrl,
  AllKeyShopCatalogIndex,
  findCandidateGamesInCatalog,
  AllKeyShopSourceAdapter,
  type CatalogGame
} from '../../src/server/sources/allkeyshop.js';
import { config } from '../../src/server/config/index.js';

describe('AllKeyShop TDD Hardening & Resolution Suite', () => {
  // =========================================================================
  // 1. stripPublisherPrefixes & Normalization
  // =========================================================================
  describe('stripPublisherPrefixes', () => {
    it('strips common publisher/franchise prefixes accurately', () => {
      expect(stripPublisherPrefixes("Tom Clancy's Rainbow Six Siege")).toBe('Rainbow Six Siege');
      expect(stripPublisherPrefixes("Tom Clancys Rainbow Six Siege")).toBe('Rainbow Six Siege');
      expect(stripPublisherPrefixes("Sid Meier's Civilization VI")).toBe('Civilization VI');
      expect(stripPublisherPrefixes("Sid Meiers Civilization VI")).toBe('Civilization VI');
      expect(stripPublisherPrefixes("Warhammer 40,000: Space Marine 2")).toBe('Space Marine 2');
      expect(stripPublisherPrefixes("Warhammer 40000 Space Marine 2")).toBe('Space Marine 2');
      expect(stripPublisherPrefixes("EA Sports FC 24")).toBe('FC 24');
      expect(stripPublisherPrefixes("Marvel's Spider-Man Remastered")).toBe('Spider-Man Remastered');
    });

    it('strips leading English articles', () => {
      expect(stripPublisherPrefixes("The Witcher 3: Wild Hunt")).toBe('Witcher 3: Wild Hunt');
      expect(stripPublisherPrefixes("A Plague Tale: Innocence")).toBe('Plague Tale: Innocence');
      expect(stripPublisherPrefixes("An Untitled Story")).toBe('Untitled Story');
    });

    it('preserves games without recognized prefixes', () => {
      expect(stripPublisherPrefixes("Cyberpunk 2077")).toBe('Cyberpunk 2077');
      expect(stripPublisherPrefixes("Elden Ring")).toBe('Elden Ring');
      expect(stripPublisherPrefixes("Hades II")).toBe('Hades II');
    });
  });

  // =========================================================================
  // 2. parseRetryAfterHeader (Dual-format parsing from api-rate-limit-handler)
  // =========================================================================
  describe('parseRetryAfterHeader', () => {
    it('parses numeric seconds string', () => {
      expect(parseRetryAfterHeader('45')).toBe(45);
      expect(parseRetryAfterHeader('120')).toBe(120);
    });

    it('parses HTTP-date format (RFC 7231 / RFC 2822)', () => {
      const futureDate = new Date(Date.now() + 65 * 1000).toUTCString();
      const delaySec = parseRetryAfterHeader(futureDate);
      // Expected to be approximately 65 seconds (allow 63-67)
      expect(delaySec).toBeGreaterThanOrEqual(63);
      expect(delaySec).toBeLessThanOrEqual(67);
    });

    it('returns default fallback when header is missing or invalid', () => {
      expect(parseRetryAfterHeader(null, 30)).toBe(30);
      expect(parseRetryAfterHeader(undefined, 40)).toBe(40);
      expect(parseRetryAfterHeader('', 25)).toBe(25);
      expect(parseRetryAfterHeader('invalid-string', 30)).toBe(30);
      expect(parseRetryAfterHeader('-10', 30)).toBe(30);
    });
  });

  // =========================================================================
  // 3. buildAksApiUrl (SSRF & Input Defense from api-security-best-practices)
  // =========================================================================
  describe('buildAksApiUrl', () => {
    it('constructs safe URLs targeting only the allowlisted AllKeyShop host', () => {
      const url = buildAksApiUrl('price_history_api.php', {
        normalised_name: 12345,
        currency: 'EUR',
        database: 'allkeyshop.com',
        v2: '1'
      });
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe('www.allkeyshop.com');
      expect(parsed.pathname).toBe('/api/price_history_api.php');
      expect(parsed.searchParams.get('normalised_name')).toBe('12345');
      expect(parsed.searchParams.get('currency')).toBe('EUR');
    });

    it('rejects attempt to escape the allowlisted domain', () => {
      expect(() => buildAksApiUrl('../../../etc/passwd', {})).toThrow(/invalid action path/i);
      expect(() => buildAksApiUrl('https://evil.com/api', {})).toThrow(/invalid action path/i);
    });

    it('validates and safely stringifies parameter values', () => {
      const url = buildAksApiUrl('test.php', {
        id: 99,
        search: 'The Witcher & Friends'
      });
      expect(url).toContain('id=99');
      expect(url).toContain('search=The+Witcher+%26+Friends');
    });
  });

  // =========================================================================
  // 4. Franchise-Aware Candidate Matching in AllKeyShopCatalogIndex
  // =========================================================================
  describe('Franchise & Multi-Alias Candidate Matching', () => {
    const catalogData: CatalogGame[] = [
      { id: 1001, name: 'Rainbow Six Siege' },
      { id: 1002, name: 'Rainbow Six Siege Year 9 Pass' },
      { id: 2001, name: 'Civilization 6' },
      { id: 2002, name: 'Civilization 6 Anthology' },
      { id: 3001, name: 'The Witcher 3 Wild Hunt' },
      { id: 4001, name: 'Grand Theft Auto 5' },
      { id: 5001, name: 'Hades 2' },
      { id: 6001, name: 'Space Marine 2' },
      { id: 7001, name: 'Cyberpunk 2077' }
    ];

    const index = new AllKeyShopCatalogIndex(catalogData);

    it('matches "Tom Clancy\'s Rainbow Six Siege" to "Rainbow Six Siege"', () => {
      const candidates = findCandidateGamesInCatalog(index, "Tom Clancy's Rainbow Six Siege");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(1001);
      expect(candidates[0].name).toBe('Rainbow Six Siege');
    });

    it('matches "Sid Meier\'s Civilization VI" to "Civilization 6"', () => {
      const candidates = findCandidateGamesInCatalog(index, "Sid Meier's Civilization VI");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(2001);
    });

    it('matches "The Witcher 3: Wild Hunt" when AKS catalog has "The Witcher 3 Wild Hunt"', () => {
      const candidates = findCandidateGamesInCatalog(index, "The Witcher 3: Wild Hunt");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(3001);
    });

    it('matches "Warhammer 40,000: Space Marine 2" to "Space Marine 2"', () => {
      const candidates = findCandidateGamesInCatalog(index, "Warhammer 40,000: Space Marine 2");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(6001);
    });

    it('matches Roman numerals: "Grand Theft Auto V" to "Grand Theft Auto 5"', () => {
      const candidates = findCandidateGamesInCatalog(index, "Grand Theft Auto V");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(4001);
    });

    it('matches Roman numerals: "Hades II" to "Hades 2"', () => {
      const candidates = findCandidateGamesInCatalog(index, "Hades II");
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(5001);
    });
  });

  // =========================================================================
  // 5. Seed Catalog Fallback Loading
  // =========================================================================
  describe('Seed Catalog Fallback Loading', () => {
    it('unpacks or falls back to bundled seed catalog when runtime catalog file is absent or incomplete', () => {
      const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-aks-test-'));
      const origDataDir = config.dataDir;

      try {
        config.dataDir = tempDir;
        const adapter = new AllKeyShopSourceAdapter();
        const catalog = adapter.loadCatalogFromDiskOrMemory();

        // Must load games from seed without throwing or returning null
        expect(catalog).not.toBeNull();
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog!.length).toBeGreaterThan(100);
      } finally {
        config.dataDir = origDataDir;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // 6. Catalog Freshness & Automatic Expiration
  // =========================================================================
  describe('Catalog Freshness & Expiration (7-Day TTL)', () => {
    it('correctly determines whether an in-memory or on-disk catalog is fresh', () => {
      const adapter = new AllKeyShopSourceAdapter();
      const mockGames: CatalogGame[] = [{ id: 1, name: 'Test Game', slug: 'test-game' }];

      // 1. Null or empty catalog is never fresh
      expect(adapter.isCatalogFresh(null)).toBe(false);
      expect(adapter.isCatalogFresh([])).toBe(false);

      // 2. forceRemote = true always bypasses freshness
      (adapter as any).lastCatalogFetch = Date.now();
      expect(adapter.isCatalogFresh(mockGames, true)).toBe(false);

      // 3. Brand new fetch (< 7 days) is fresh
      (adapter as any).lastCatalogFetch = Date.now() - (2 * 24 * 60 * 60 * 1000); // 2 days ago
      expect(adapter.isCatalogFresh(mockGames, false)).toBe(true);

      // 4. Stale fetch (> 7 days) is expired
      (adapter as any).lastCatalogFetch = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      expect(adapter.isCatalogFresh(mockGames, false)).toBe(false);
    });
  });
});
