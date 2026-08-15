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

// ISO country codes and tokens for foreign regions locked outside EU/HU
const RESTRICTED_COUNTRY_CODES = new Set([
  'US', 'USA', 'CA', 'CAN', 
  'RU', 'RUS', 'CIS',
  'TR', 'TUR',
  'EG', 'EGY',
  'AR', 'ARG',
  'BR', 'BRA',
  'CN', 'CHN',
  'IN', 'IND',
  'AU', 'AUS', 'NZ', 'NZL',
  'LATAM', 'ASIA', 'SEA'
]);

const RESTRICTED_WORDS = [
  /\b(united\s*states|usa?|north\s*america|na\s*only)\b/i,
  /\b(russia|russian\s*federation|cis\s*countries)\b/i,
  /\b(turkey|turkish)\b/i,
  /\b(egypt|egyptian)\b/i,
  /\b(argentina|argentine)\b/i,
  /\b(brazil|brazilian|latam|latin\s*america)\b/i,
  /\b(china|chinese|asia\s*only|sea\s*only)\b/i,
  /\b(india|indian)\b/i,
  /\b(australia|new\s*zealand)\b/i,
];

// EU / EEA / European Union countries
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 
  'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'NO', 'IS', 'LI', 
  'CH', 'GB', 'UK', 'EU', 'EEA'
]);

/**
 * Validates and classifies product type.
 * Discards any account-based products as per specification.
 */
export function normalizeProductType(rawType: string = ''): NormalizedProduct {
  const clean = rawType.trim().toLowerCase();

  for (const pattern of FORBIDDEN_ACCOUNT_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        productType: 'DIRECT_PURCHASE',
        isValid: false,
        rejectReason: `Account-based product excluded (${rawType})`
      };
    }
  }

  if (clean.includes('gift') || clean.includes('steam gift')) {
    return {
      productType: 'STEAM_GIFT',
      isValid: true
    };
  }

  if (clean.includes('direct') || clean.includes('store') || clean.includes('connect')) {
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
 */
export function normalizeRegion(rawRegion: string = '', rawCountry: string = ''): NormalizedRegion {
  const regionUpper = rawRegion.trim().toUpperCase();
  const countryUpper = rawCountry.trim().toUpperCase();
  const combined = `${rawRegion} ${rawCountry}`.trim();

  // 1. Direct match on ISO codes if provided
  if (RESTRICTED_COUNTRY_CODES.has(regionUpper) || RESTRICTED_COUNTRY_CODES.has(countryUpper)) {
    return {
      regionType: 'RESTRICTED',
      regionCode: regionUpper || countryUpper,
      regionConfidence: 0.0,
      isValid: false,
      rejectReason: `Region country code (${regionUpper || countryUpper}) locked outside Hungary/EU`
    };
  }

  if (countryUpper === 'HU' || regionUpper === 'HU' || /\b(hu|hungary)\b/i.test(combined)) {
    return {
      regionType: 'HU',
      regionCode: 'HU',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  if (EU_COUNTRIES.has(regionUpper) || EU_COUNTRIES.has(countryUpper) || /\b(eu|europe|eea|emea|european\s*union)\b/i.test(combined)) {
    return {
      regionType: 'EU',
      regionCode: regionUpper || 'EU',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  // 2. Global / Worldwide / Region Free / ROW
  if (/\b(global|worldwide|ww|region\s*free|row)\b/i.test(combined) || combined === '') {
    return {
      regionType: 'GLOBAL',
      regionCode: 'GLOBAL',
      regionConfidence: 1.0,
      isValid: true
    };
  }

  // 3. Check for restricted full words (e.g. "United States", "Egypt", "Turkey", "Russia")
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

  // Fallback: If unknown string not containing restricted keywords, treat as Global with medium confidence
  return {
    regionType: 'GLOBAL',
    regionCode: rawRegion || 'UNKNOWN',
    regionConfidence: 0.7,
    isValid: true
  };
}

/**
 * Converts other currencies to EUR if necessary (e.g. USD / GBP standard rates)
 */
export function convertToEur(price: number, currency: string = 'EUR'): number {
  const curr = currency.toUpperCase().trim();
  if (curr === 'EUR' || curr === '€') return Math.round(price * 100) / 100;
  if (curr === 'USD' || curr === '$') return Math.round(price * 0.92 * 100) / 100;
  if (curr === 'GBP' || curr === '£') return Math.round(price * 1.17 * 100) / 100;
  return Math.round(price * 100) / 100;
}
