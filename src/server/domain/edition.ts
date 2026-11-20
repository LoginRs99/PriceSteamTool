/**
 * PriceSteamTool — Edition Normalization & Stream Partitioning
 *
 * Normalizes edition names into canonical keys to ensure distinct products
 * (e.g. Standard, Deluxe, Complete, Gold, GOTY) maintain independent price streams.
 */

export interface NormalizedEdition {
  editionKey: string;
  editionName: string;
  identityConfidence: 'CONFIDENT' | 'AMBIGUOUS';
}

const CANONICAL_EDITIONS: Array<{ key: string; name: string; regex: RegExp }> = [
  { key: 'standard', name: 'Standard Edition', regex: /^(standard(\s+edition|\s+pack)?|base(\s+game)?)$/i },
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
  title?: string | null,
  sourceCode?: string
): NormalizedEdition {
  // 1. Direct raw edition string (e.g. from NEXARDA)
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

    // Slugify custom/unusual edition (e.g. "Alex Murphy Edition", "Super Citizen Edition")
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

  // 2. Extract from title if title is provided
  if (title && typeof title === 'string') {
    for (const entry of CANONICAL_EDITIONS) {
      if (entry.key !== 'standard' && entry.regex.test(title)) {
        return {
          editionKey: entry.key,
          editionName: entry.name,
          identityConfidence: 'CONFIDENT'
        };
      }
    }
  }

  // 3. Fallback for sources without explicit edition tags
  // Steam Storefront is explicitly the base game
  if (sourceCode === 'steam') {
    return {
      editionKey: 'standard',
      editionName: 'Standard Edition',
      identityConfidence: 'CONFIDENT'
    };
  }

  // Default canonical standard edition
  return {
    editionKey: 'standard',
    editionName: 'Standard Edition',
    identityConfidence: 'CONFIDENT'
  };
}
