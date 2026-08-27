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
  'LATAM', 'ASIA', 'SEA'
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

  // Fallback: If unknown / unverified region string, reject to prevent surfacing region-incompatible deals
  return {
    regionType: 'RESTRICTED',
    regionCode: rawRegion || 'UNKNOWN',
    regionConfidence: 0.0,
    isValid: false,
    rejectReason: `Unverified / ambiguous activation region (${rawRegion})`
  };
}

import { exchangeRateService } from './exchangeRate.js';

/**
 * Converts other currencies to EUR using dynamic exchange rates.
 */
export function convertToEur(price: number, currency: string = 'EUR'): number {
  return exchangeRateService.convertToEur(price, currency);
}

