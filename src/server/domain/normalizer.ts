import type { ProductType, RegionType } from '../../shared/types.js';

export interface NormalizedProduct {
  productType: ProductType;
  isValid: boolean;
  rejectReason?: string;
}

export interface NormalizedRegion {
  regionType: RegionType;
  regionCode: string;
  regionConfidence: number;
  isValid: boolean;
  rejectReason?: string;
}

const FORBIDDEN_ACCOUNT_PATTERNS = [
  /\baccount\b/i,
  /\bshared\b/i,
  /\boffline\s*activation\b/i,
  /\baccount\s*login\b/i,
  /\baccount\s*transfer\b/i,
  /\bfamily\s*share\b/i,
  /\bsteam\s*account\b/i,
  /\bpre-made\s*account\b/i,
  /\bprime\s*account\b/i,
  /\bprofile\s*activation\b/i,
];

const FORBIDDEN_NON_STEAM_PLATFORMS = [
  /\bgog\b/i,
  /\bepic(\s*games?|\s*game\s*store)?\b/i,
  /\borigin\b/i,
  /\bea\s*app\b/i,
  /\belectronic\s*arts\b/i,
  /\buplay\b/i,
  /\bubisoft(\s*connect)?\b/i,
  /\bbattle\.net\b/i,
  /\bblizzard\b/i,
  /\brockstar(\s*games|\s*launcher)?\b/i,
  /\bmicrosoft\s*store\b/i,
  /\bxbox(\s*live|\s*one|\s*series|\s*360)?\b/i,
  /\bplaystation(\s*[345])?\b/i,
  /\bps[345]\b/i,
  /\bpsn\b/i,
  /\bnintendo(\s*switch|\s*wii)?\b/i,
  /\bdrm[\s-]*free\b/i,
  /\bnon-steam\b/i,
  /\bwindows\s*(10|11)(\s*eu)?\b/i
];

// ISO country codes and tokens for foreign regions locked outside EU/HU
const RESTRICTED_COUNTRY_CODES = new Set([
  'US', 'USA', 'CA', 'CAN', 'NA', 'US/CA', 'CAN/US',
  'RU', 'RUS', 'CIS', 'RU/CIS', 'CIS/RU',
  'TR', 'TUR',
  'EG', 'EGY',
  'AR', 'ARG',
  'BR', 'BRA',
  'CN', 'CHN',
  'IN', 'IND',
  'AU', 'AUS', 'NZ', 'NZL',
  'LATAM', 'ASIA', 'SEA',
  'ROW'
]);

const RESTRICTED_WORDS = [
  /\b(united\s*states|usa?|north\s*america|na(\s*only)?|us\/ca)\b/i,
  /\b(russia|russian\s*federation|cis(\s*countries)?|ru\/cis|cis\/ru)\b/i,
  /\b(turkey|turkish)\b/i,
  /\b(egypt|egyptian)\b/i,
  /\b(argentina|argentine)\b/i,
  /\b(brazil|brazilian|latam|latin\s*america)\b/i,
  /\b(china|chinese|asia\s*only|sea\s*only)\b/i,
  /\b(india|indian)\b/i,
  /\b(australia|new\s*zealand)\b/i,
  /\b(row|rest\s*of\s*world)\b/i,
];

// The 27 EU Member States
export const EU_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 
  'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
]);

// Non-EU EEA Countries
export const EEA_COUNTRIES = new Set([
  'NO', 'IS', 'LI'
]);

// Non-EU European nations that have separate region locking
export const UK_COUNTRY_CODES = new Set(['GB', 'UK']);
export const SWISS_COUNTRY_CODES = new Set(['CH']);

/**
 * Validates and classifies product type.
 * Discards any account-based products and non-Steam platforms (GOG, Epic, Ubisoft, EA, etc.).
 */
export function normalizeProductType(rawType: string = '', merchantOrStoreName?: string): NormalizedProduct {
  const clean = `${rawType} ${merchantOrStoreName || ''}`.trim().toLowerCase();

  for (const pattern of FORBIDDEN_ACCOUNT_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        productType: 'DIRECT_PURCHASE',
        isValid: false,
        rejectReason: `Account-based product excluded (${rawType})`
      };
    }
  }

  for (const pattern of FORBIDDEN_NON_STEAM_PLATFORMS) {
    if (pattern.test(clean)) {
      return {
        productType: 'DIRECT_PURCHASE',
        isValid: false,
        rejectReason: `Non-Steam platform excluded (${rawType})`
      };
    }
  }

  if (clean.includes('gift') || clean.includes('steam gift')) {
    return {
      productType: 'STEAM_GIFT',
      isValid: true
    };
  }

  if (clean.includes('direct') || clean.includes('store.steampowered') || clean.includes('steam direct') || clean.includes('steam connect')) {
    return {
      productType: 'DIRECT_PURCHASE',
      isValid: true
    };
  }

  // Default to Steam Key (also includes "cd key", "key", "digital code", etc.)
  return {
    productType: 'STEAM_KEY',
    isValid: true
  };
}

/**
 * Normalizes region strings and ensures Hungary / EU / Global activation compatibility.
 * Strictly distinguishes EU/EEA from non-EU regions (UK, Switzerland) and rejects non-compatible locks.
 */
export function normalizeRegion(rawRegion: string = '', rawCountry: string = ''): NormalizedRegion {
  const regionUpper = rawRegion.trim().toUpperCase();
  const countryUpper = rawCountry.trim().toUpperCase();
  const combined = `${rawRegion} ${rawCountry}`.trim();

  // 1. Direct match on restricted ISO codes
  if (RESTRICTED_COUNTRY_CODES.has(regionUpper) || RESTRICTED_COUNTRY_CODES.has(countryUpper)) {
    return {
      regionType: 'RESTRICTED',
      regionCode: regionUpper || countryUpper,
      regionConfidence: 0.0,
      isValid: false,
      rejectReason: `Region country code (${regionUpper || countryUpper}) locked outside Hungary/EU`
    };
  }

  // 2. UK Specific check (UK is not EU and UK-only keys cannot activate in Hungary)
  if (UK_COUNTRY_CODES.has(regionUpper) || UK_COUNTRY_CODES.has(countryUpper) || /\b(united\s*kingdom|great\s*britain|uk\s*only|gb\s*only)\b/i.test(combined)) {
    return {
      regionType: 'RESTRICTED',
      regionCode: 'GB',
      regionConfidence: 0.0,
      isValid: false,
      rejectReason: 'UK-locked region offer is not compatible with Hungary activation'
    };
  }

  // 3. Switzerland Specific check (Switzerland is not EU/EEA and Swiss-only keys are restricted)
  if (SWISS_COUNTRY_CODES.has(regionUpper) || SWISS_COUNTRY_CODES.has(countryUpper) || /\b(switzerland|swiss|ch\s*only)\b/i.test(combined)) {
    return {
      regionType: 'RESTRICTED',
      regionCode: 'CH',
      regionConfidence: 0.0,
      isValid: false,
      rejectReason: 'Switzerland-locked region offer is not compatible with Hungary activation'
    };
  }

  // 4. Hungary Direct Match
  if (countryUpper === 'HU' || regionUpper === 'HU' || /\b(hu|hungary)\b/i.test(combined)) {
    return {
      regionType: 'HU',
      regionCode: 'HU',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  // 5. EU Member States & EEA Countries or broad European Union / Europe activation scope
  if (
    EU_MEMBER_STATES.has(regionUpper) || EU_MEMBER_STATES.has(countryUpper) ||
    EEA_COUNTRIES.has(regionUpper) || EEA_COUNTRIES.has(countryUpper) ||
    regionUpper === 'EU' || regionUpper === 'EEA' ||
    /\b(eu|europe|eea|emea|european\s*union)\b/i.test(combined)
  ) {
    return {
      regionType: 'EU',
      regionCode: regionUpper || countryUpper || 'EU',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  // 6. Global / Worldwide / Region Free
  // NOTE: "ROW" (Rest of World) is deliberately excluded here — in key reselling,
  // ROW typically means "everywhere EXCEPT EU/US/UK" and is usually not activatable in Hungary.
  // It is explicitly rejected as RESTRICTED above.
  if (/\b(global|worldwide|ww|region\s*free)\b/i.test(combined) || combined === '') {
    return {
      regionType: 'GLOBAL',
      regionCode: 'GLOBAL',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  // 7. Check for restricted full words (e.g. "United States", "Egypt", "Turkey", "Russia")
  for (const pattern of RESTRICTED_WORDS) {
    if (pattern.test(combined)) {
      return {
        regionType: 'RESTRICTED',
        regionCode: rawRegion || 'RESTRICTED',
        regionConfidence: 0.0,
        isValid: false,
        rejectReason: `Region pattern locked outside Hungary/EU (${rawRegion})`
      };
    }
  }

  // Fallback: If unknown / unverified region string, reject to prevent surfacing region-incompatible deals
  return {
    regionType: 'RESTRICTED',
    regionCode: rawRegion || 'UNKNOWN',
    regionConfidence: 0.0,
    isValid: false,
    rejectReason: `Unrecognized region code locked outside Hungary/EU (${rawRegion || 'UNKNOWN'})`
  };
}

/**
 * Converts common Roman numerals to Arabic numbers at word boundaries
 */
export function convertRomanNumerals(title: string): string {
  if (!title) return '';
  const romanMap: Record<string, string> = {
    'viii': '8',
    'vii': '7',
    'iii': '3',
    'iv': '4',
    'vi': '6',
    'ix': '9',
    'ii': '2',
    'v': '5',
    'x': '10',
    'i': '1'
  };

  return title.replace(/\b(viii|vii|iii|iv|vi|ix|ii|v|x|i)\b/gi, (match) => {
    return romanMap[match.toLowerCase()] || match;
  });
}

const CP1250_CHARS: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x015A, 0x8D: 0x0164, 0x8E: 0x017D,
  0x8F: 0x0179, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x015B,
  0x9D: 0x0165, 0x9E: 0x017E, 0x9F: 0x017A, 0xA1: 0x02C7, 0xA2: 0x02D8, 0xA3: 0x0141,
  0xA5: 0x0104, 0xAA: 0x015E, 0xAF: 0x017B, 0xB2: 0x02DB, 0xB3: 0x0142, 0xB9: 0x0105,
  0xBA: 0x015F, 0xBC: 0x013D, 0xBD: 0x02DD, 0xBE: 0x013E, 0xBF: 0x017C, 0xC3: 0x0102,
  0xC5: 0x0139, 0xC6: 0x0106, 0xC8: 0x010C, 0xCA: 0x0118, 0xCC: 0x011A, 0xCF: 0x010E,
  0xD0: 0x0110, 0xD1: 0x0143, 0xD2: 0x0147, 0xD5: 0x0150, 0xD8: 0x0158, 0xD9: 0x016E,
  0xDB: 0x0170, 0xDE: 0x0162, 0xE3: 0x0103, 0xE5: 0x013A, 0xE6: 0x0107, 0xE8: 0x010D,
  0xEA: 0x0119, 0xEC: 0x011B, 0xEF: 0x010F, 0xF0: 0x0111, 0xF1: 0x0144, 0xF2: 0x0148,
  0xF5: 0x0151, 0xF8: 0x0159, 0xF9: 0x016F, 0xFB: 0x0171, 0xFE: 0x0163
};

const CP1252_CHARS: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
  0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
  0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178
};

const REVERSE_CP1250 = new Map<string, number>();
for (const [b, c] of Object.entries(CP1250_CHARS)) {
  REVERSE_CP1250.set(String.fromCharCode(c), Number(b));
}

const REVERSE_CP1252 = new Map<string, number>();
for (const [b, c] of Object.entries(CP1252_CHARS)) {
  REVERSE_CP1252.set(String.fromCharCode(c), Number(b));
}

/**
 * Detects and repairs UTF-8 text mistakenly decoded under CP1250 (Central European) or CP1252 (Western European).
 * Safe against authentic accented European strings (e.g. Kraków, Petőfi, Dvořák).
 */
export function repairMojibake(str: string): string {
  if (!str || typeof str !== 'string') return '';
  if (!/[âãäåæçèéêëìíîïðñòóôõöøùúûüýþÿďĺćăčěňřšťž]/.test(str)) {
    return str;
  }

  const tryDecode = (map: Map<string, number>): string | null => {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const code = ch.charCodeAt(0);
      if (map.has(ch)) {
        bytes.push(map.get(ch)!);
      } else if (code <= 0xFF) {
        bytes.push(code);
      } else {
        return null;
      }
    }
    try {
      const buf = Buffer.from(bytes);
      const dec = buf.toString('utf8');
      if (!dec.includes('\uFFFD') && dec !== str) {
        return dec;
      }
    } catch {}
    return null;
  };

  return tryDecode(REVERSE_CP1250) || tryDecode(REVERSE_CP1252) || str;
}

/**
 * Robust title normalizer handling Roman numerals, symbols, editions, and special tags.
 * Never throws exceptions even on malformed or nullish inputs.
 */
export function normalizeGameTitle(rawTitle: string = ''): string {
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) return '';

  try {
    const repairedTitle = repairMojibake(rawTitle);
    let clean = repairedTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip diacritics
      .toLowerCase()
      .replace(/[™®©]/g, ' ') // strip trademark/copyright symbols
      .replace(/[:_+\-/\\&|]/g, ' '); // normalize separators to space

    // Canonicalize Roman numerals to digits
    clean = convertRomanNumerals(clean);

    // Strip common non-game noise words and edition tags
    clean = clean
      .replace(/\b(game\s*of\s*the\s*year(\s*edition)?|goty(\s*edition)?)\b/g, ' ')
      .replace(/\b(definitive|remastered|remaster|deluxe|standard|gold|ultimate|premium|collector'?s?|special|enhanced|anniversary)(\s*edition)?\b/g, ' ')
      .replace(/\b(edition|director'?s?\s*cut|remake|reboot|bundle|pack|pc)\b/g, ' ');

    // Retain only alphanumeric characters
    return clean.replace(/[^a-z0-9]/g, '').trim();
  } catch {
    // Ultimate fallback for bizarre Unicode inputs
    return String(rawTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

import { exchangeRateService } from './exchangeRate.js';

/**
 * Converts other currencies to EUR using dynamic exchange rates.
 */
export function convertToEur(price: number, currency: string = 'EUR'): number {
  return exchangeRateService.convertToEur(price, currency);
}


