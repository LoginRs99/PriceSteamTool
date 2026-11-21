/**
 * PriceSteamTool — Edition Normalization & Stream Partitioning
 *
 * Normalizes edition names into canonical keys to ensure distinct products
 * (e.g. Standard, Deluxe, Complete, Gold, GOTY) maintain independent price streams.
 *
 * Strict Confidence Rules:
 * - Emits 'CONFIDENT' only when:
 *   1. Upstream payload explicitly provides an edition string (e.g. NEXARDA item.edition).
 *   2. Title or URL explicitly contains a canonical edition pattern (e.g. "Deluxe Edition", "GOTY").
 *   3. Provider endpoint architecture structurally guarantees base application package
 *      (Steam appdetails price_overview; ITAD canonical game UUID resolved via /games/lookup/v1).
 * - Emits 'AMBIGUOUS' when:
 *   1. Aggregators (GG.deals, SuperDuperBundle) lack edition metadata and package IDs.
 *   2. Unlabelled or unverified offers where base-game identity cannot be proven.
 */

export interface NormalizedEdition {
  editionKey: string;
  editionName: string;
  identityConfidence: 'CONFIDENT' | 'AMBIGUOUS';
}

const CANONICAL_EDITIONS: Array<{ key: string; name: string; regex: RegExp }> = [
  { key: 'standard', name: 'Standard Edition', regex: /\b(standard(\s+edition|\s+pack)?|base(\s+game)?)\b/i },
  { key: 'deluxe', name: 'Deluxe Edition', regex: /\b(digital\s+deluxe|deluxe\s+edition|deluxe(\s+pack)?)\b/i },
  { key: 'ultimate', name: 'Ultimate Edition', regex: /\b(ultimate\s+edition|ultimate(\s+pack)?)\b/i },
  { key: 'gold', name: 'Gold Edition', regex: /\b(gold\s+edition|gold(\s+pack)?)\b/i },
  { key: 'complete', name: 'Complete Edition', regex: /\b(the\s+complete\s+edition|complete\s+edition|complete\s+collection|complete\s+story)\b/i },
  { key: 'collectors', name: "Collector's Edition", regex: /\b(collector'?s\s+edition|collectors\s+edition)\b/i },
  { key: 'goty', name: 'GOTY Edition', regex: /\b(goty\s+edition|game\s+of\s+the\s+year(\s+edition)?|goty)\b/i },
  { key: 'premium', name: 'Premium Edition', regex: /\b(premium\s+deluxe\s+edition|premium\s+edition)\b/i },
  { key: 'special', name: 'Special Edition', regex: /\b(special\s+edition|definitive\s+edition|enhanced\s+edition)\b/i },
  { key: 'super_deluxe', name: 'Super Deluxe Edition', regex: /\b(super\s+deluxe\s+edition)\b/i },
  { key: 'supporter', name: 'Supporter Edition', regex: /\b(supporter\s+edition)\b/i },
  { key: 'anniversary', name: 'Anniversary Edition', regex: /\b(\d+-year\s+anniversary\s+edition|anniversary\s+edition)\b/i },
];

/**
 * Normalizes raw edition string or title into a canonical edition key and clean display name.
 */
export function normalizeEdition(
  editionRaw?: string | null,
  titleOrUrl?: string | null,
  sourceCode?: string
): NormalizedEdition {
  // 1. Direct raw edition string (e.g. from NEXARDA item.edition)
  if (editionRaw && typeof editionRaw === 'string' && editionRaw.trim().length > 0) {
    const rawClean = editionRaw.trim();
    for (const entry of CANONICAL_EDITIONS) {
      if (entry.regex.test(rawClean)) {
        return {
          editionKey: entry.key,
          editionName: entry.name,
          identityConfidence: 'CONFIDENT'
        };
      }
    }

    // Custom edition tag (e.g. "Alex Murphy Edition", "Super Citizen Edition")
    const customKey = rawClean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return {
      editionKey: customKey || 'standard',
      editionName: rawClean,
      identityConfidence: 'CONFIDENT'
    };
  }

  // 2. Extract from title or URL slug if provided
  if (titleOrUrl && typeof titleOrUrl === 'string') {
    const textClean = titleOrUrl.replace(/[-_./]+/g, ' ').trim();
    for (const entry of CANONICAL_EDITIONS) {
      if (entry.key !== 'standard' && entry.regex.test(textClean)) {
        return {
          editionKey: entry.key,
          editionName: entry.name,
          identityConfidence: 'CONFIDENT'
        };
      }
      // If title explicitly states "Standard Edition"
      if (entry.key === 'standard' && entry.regex.test(textClean)) {
        return {
          editionKey: 'standard',
          editionName: 'Standard Edition',
          identityConfidence: 'CONFIDENT'
        };
      }
    }
  }

  // 3. Provider Architectural Scrutiny:
  // Steam Storefront: appdetails queries canonical base App ID with price_overview of primary package
  if (sourceCode === 'steam') {
    return {
      editionKey: 'standard',
      editionName: 'Standard Edition',
      identityConfidence: 'CONFIDENT'
    };
  }

  // ITAD: Resolved via /games/lookup/v1?appid=... to canonical base game UUID
  if (sourceCode === 'itad') {
    return {
      editionKey: 'standard',
      editionName: 'Standard Edition',
      identityConfidence: 'CONFIDENT'
    };
  }

  // CheapShark: store-based deals where title has no edition markers
  if (sourceCode === 'cheapshark') {
    return {
      editionKey: 'standard',
      editionName: 'Standard Edition',
      identityConfidence: 'CONFIDENT'
    };
  }

  // 4. GG.deals and SuperDuperBundle:
  // Multi-store aggregators without package IDs or explicit edition fields.
  // Missing metadata CANNOT be assumed to be Standard Edition with confidence.
  if (sourceCode === 'ggdeals' || sourceCode === 'superduperbundle') {
    return {
      editionKey: 'standard',
      editionName: 'Standard Edition (Unverified)',
      identityConfidence: 'AMBIGUOUS'
    };
  }

  // 5. Default unresolved / unverified identity fallback
  return {
    editionKey: 'standard',
    editionName: 'Standard Edition (Unverified)',
    identityConfidence: 'AMBIGUOUS'
  };
}
