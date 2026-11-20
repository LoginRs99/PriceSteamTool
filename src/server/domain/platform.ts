/**
 * PriceSteamTool — Activation Platform & DRM Identity Normalization
 *
 * Normalizes DRM and activation platform information to prevent cross-platform
 * price collisions (e.g. Steam Key vs Epic Key vs GOG Key sold by the same merchant).
 */

export type ActivationPlatform =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'ubisoft'
  | 'ea'
  | 'rockstar'
  | 'battlenet'
  | 'microsoft'
  | 'drm_free'
  | 'unknown';

export interface NormalizedPlatform {
  platform: ActivationPlatform;
  platformName: string;
  isSteam: boolean;
  confidence: 'CONFIDENT' | 'AMBIGUOUS';
}

const PLATFORM_RULES: Array<{
  platform: ActivationPlatform;
  name: string;
  regex: RegExp;
}> = [
  { platform: 'steam', name: 'Steam', regex: /\b(steam(\s*key|\s*gift|\s*connect|\s*store)?)\b/i },
  { platform: 'epic', name: 'Epic Games', regex: /\b(epic(\s*games?|\s*game\s*store)?)\b/i },
  { platform: 'gog', name: 'GOG.com', regex: /\b(gog(\.com)?)\b/i },
  { platform: 'ubisoft', name: 'Ubisoft Connect', regex: /\b(ubisoft(\s*connect)?|uplay)\b/i },
  { platform: 'ea', name: 'EA App', regex: /\b(ea(\s*app)?|origin|electronic\s*arts)\b/i },
  { platform: 'rockstar', name: 'Rockstar Games Launcher', regex: /\b(rockstar(\s*games|\s*launcher)?)\b/i },
  { platform: 'battlenet', name: 'Battle.net', regex: /\b(battle\.net|blizzard)\b/i },
  { platform: 'microsoft', name: 'Microsoft Store / Xbox', regex: /\b(microsoft(\s*store)?|xbox(\s*live|\s*on\s*pc)?|windows\s*store)\b/i },
  { platform: 'drm_free', name: 'DRM-Free', regex: /\b(drm[\s-]*free)\b/i },
];

/**
 * Normalizes raw DRM or platform strings into a canonical ActivationPlatform.
 */
export function normalizeActivationPlatform(
  rawDrm?: string | null,
  rawPlatform?: string | null,
  storeName?: string | null,
  sourceCode?: string | null
): NormalizedPlatform {
  // Steam Storefront is always 100% Steam
  if (sourceCode === 'steam') {
    return {
      platform: 'steam',
      platformName: 'Steam',
      isSteam: true,
      confidence: 'CONFIDENT'
    };
  }

  const combined = `${rawDrm || ''} ${rawPlatform || ''} ${storeName || ''}`.trim().toLowerCase();

  // Check explicit DRM and platform keywords
  for (const rule of PLATFORM_RULES) {
    if (rule.regex.test(combined)) {
      return {
        platform: rule.platform,
        platformName: rule.name,
        isSteam: rule.platform === 'steam',
        confidence: 'CONFIDENT'
      };
    }
  }

  // Specific store name indicators
  if (storeName) {
    const sLower = storeName.toLowerCase();
    if (sLower.includes('steam')) {
      return { platform: 'steam', platformName: 'Steam', isSteam: true, confidence: 'CONFIDENT' };
    }
    if (sLower.includes('gog')) {
      return { platform: 'gog', platformName: 'GOG.com', isSteam: false, confidence: 'CONFIDENT' };
    }
    if (sLower.includes('epic')) {
      return { platform: 'epic', platformName: 'Epic Games', isSteam: false, confidence: 'CONFIDENT' };
    }
    if (sLower.includes('ubisoft') || sLower.includes('uplay')) {
      return { platform: 'ubisoft', platformName: 'Ubisoft Connect', isSteam: false, confidence: 'CONFIDENT' };
    }
    if (sLower.includes('origin') || sLower.includes('ea app')) {
      return { platform: 'ea', platformName: 'EA App', isSteam: false, confidence: 'CONFIDENT' };
    }
  }

  // If source is GG.deals querying by Steam App ID without DRM details
  if (sourceCode === 'ggdeals') {
    // GG.deals queried by-steam-app-id targets the Steam page, but without DRM field
    return {
      platform: 'steam',
      platformName: 'Steam',
      isSteam: true,
      confidence: 'CONFIDENT'
    };
  }

  // Fallback: If metadata is absent or unspecified (e.g. "PC", "Digital"), mark as unknown with AMBIGUOUS confidence
  return {
    platform: 'unknown',
    platformName: 'Unknown Platform',
    isSteam: false,
    confidence: 'AMBIGUOUS'
  };
}
