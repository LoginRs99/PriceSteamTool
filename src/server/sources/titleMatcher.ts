/**
 * Intelligent game title matching and candidate scoring engine.
 * 
 * Provides:
 * - Deterministic title cleaning and edition-suffix stripping
 * - Query variation generation (ampersands, Roman numerals, subtitles, author prefixes)
 * - Anti-collision number/sequel verification (preventing cross-game false positives)
 * - Multi-metric candidate similarity scoring (Dice bigrams + Jaccard token overlap + release year check)
 */


const AUTHOR_PREFIXES = [
  /^tom clancy'?s\s+/i,
  /^sid meier'?s\s+/i,
  /^american mcgee'?s\s+/i,
  /^clancy'?s\s+/i,
  /^disney'?s\s+/i
];

export function normalizeCommasInNumbers(str: string): string {
  return str.replace(/(\d),(\d)/g, '$1$2');
}

/**
 * Strips noise, bracketed/parenthesized years, bracketed tags, author prefixes, and edition phrases.
 */
export function stripEditionSuffixes(title: string): string {
  if (!title || typeof title !== 'string') return '';

  let cleaned = title
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .replace(/\s*\((19\d\d|20\d\d)\)/g, '')
    .replace(/\s*\[(19\d\d|20\d\d)\]/g, '')
    .replace(/\s*\((classic|original|remastered|goty|steam|pc)\)/gi, '')
    .replace(/\s*\[(classic|original|remastered|goty|steam|pc)\]/gi, '')
    .trim();

  // If there's a multilingual slash (e.g. "Valiant Hearts: The Great War / Soldats Inconnus..."), take first part
  if (cleaned.includes(' / ')) {
    cleaned = cleaned.split(' / ')[0].trim();
  }

  // Strip author prefixes (e.g. "Sid Meier's Civilization" -> "Civilization")
  for (const prefix of AUTHOR_PREFIXES) {
    cleaned = cleaned.replace(prefix, '').trim();
  }

  const EDITION_REGEX = /\s*[:\-\—\–]?\s*(the complete edition|the complete pack|complete edition|complete collection|complete story|anniversary edition|enchanted edition|developer'?s cut|directors cut|director'?s cut|ultimate collection|ultimate edition|seekers edition|premium edition|slayer edition|digital deluxe edition|deluxe edition|game of the year edition|game of the year|goty edition|goty|enhanced edition|definitive edition|special edition|gold edition|platinum edition|collector'?s edition|collectors edition|standard edition|legacy edition|master edition|classic edition|classic)\s*$/i;

  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(EDITION_REGEX, '').trim();
  } while (cleaned !== prev);

  cleaned = cleaned.replace(/[:\-\—\–]\s*$/, '').trim();
  return cleaned.replace(/\s+/g, ' ');
}

/**
 * Normalizes a game title for strict token and character comparison.
 * Collapses Roman numerals to digits, strips non-alphanumeric chars, removes punctuation.
 */
export function normalizeForMatch(str: string): string {
  if (!str) return '';

  return normalizeCommasInNumbers(str)
    .toLowerCase()
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .replace(/\s*\((19\d\d|20\d\d)\)/g, '')
    .replace(/\s*\[(19\d\d|20\d\d)\]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bxvi\b/g, '16')
    .replace(/\bxv\b/g, '15')
    .replace(/\bxiv\b/g, '14')
    .replace(/\bxiii\b/g, '13')
    .replace(/\bxii\b/g, '12')
    .replace(/\bxi\b/g, '11')
    .replace(/\bx\b/g, '10')
    .replace(/\bix\b/g, '9')
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\biv\b/g, '4')
    .replace(/\bv\b/g, '5')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts all distinct digit tokens from a normalized title (e.g. "2", "3", "2077").
 */
export function extractNumbers(norm: string): string[] {
  const matches = norm.match(/\b\d+\b/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Computes Sørensen–Dice coefficient on character bigrams (0.0 to 1.0).
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2));
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    if (bigramsA.has(bg)) {
      intersection++;
    }
  }

  return (2.0 * intersection) / ((a.length - 1) + (b.length - 1));
}

/**
 * Computes Jaccard similarity over word tokens (0.0 to 1.0).
 */
export function jaccardSimilarity(wordsA: Set<string>, wordsB: Set<string>): number {
  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? overlap / union : 0.0;
}


/**
 * Generates an ordered, deduplicated list of search query candidates to maximize lookup recall.
 */
export function generateSearchQueryCandidates(rawTitle: string): string[] {
  if (!rawTitle?.trim()) return [];

  const candidates: string[] = [];
  const baseStripped = stripEditionSuffixes(rawTitle);

  // 1. Base title stripped of edition suffixes and brackets
  if (baseStripped.length >= 2) {
    candidates.push(baseStripped);
  }

  // 2. Subtitle split before colon or dash (if >= 4 chars)
  const subtitleSplit = baseStripped.split(/[:\-\—\–]/);
  if (subtitleSplit.length > 1 && subtitleSplit[0].trim().length >= 4) {
    candidates.push(subtitleSplit[0].trim());
  }

  // 3. Ampersand variation (& <-> and)
  if (baseStripped.includes(' and ')) {
    candidates.push(baseStripped.replace(/\band\b/gi, '&'));
  } else if (baseStripped.includes('&')) {
    candidates.push(baseStripped.replace(/&/g, 'and'));
  }

  // 4. Roman numeral variation (e.g. "Final Fantasy VIII" -> "Final Fantasy 8")
  const romanReplacements: [RegExp, string][] = [
    [/\bVIII\b/g, '8'],
    [/\bVII\b/g, '7'],
    [/\bVI\b/g, '6'],
    [/\bIV\b/g, '4'],
    [/\bV\b/g, '5'],
    [/\bIII\b/g, '3'],
    [/\bII\b/g, '2']
  ];
  let romanVariant = baseStripped;
  for (const [re, rep] of romanReplacements) {
    romanVariant = romanVariant.replace(re, rep);
  }
  if (romanVariant !== baseStripped) {
    candidates.push(romanVariant);
  }

  // 5. Author prefix stripped (e.g. "Tom Clancy's Rainbow Six Vegas" -> "Rainbow Six Vegas")
  for (const prefix of AUTHOR_PREFIXES) {
    if (prefix.test(baseStripped)) {
      const strippedPrefix = baseStripped.replace(prefix, '').trim();
      if (strippedPrefix.length >= 3) {
        candidates.push(strippedPrefix);
      }
    }
  }

  // 6. Clean raw title (without edition stripping, in case the edition is in the catalog title)
  const cleanRaw = rawTitle.replace(/[\u2122\u00ae\u00a9]/g, '').trim();
  if (cleanRaw !== baseStripped && cleanRaw.length >= 2) {
    candidates.push(cleanRaw);
  }

  // Deduplicate and cap to at most 4 queries
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of candidates) {
    const trimmed = c.trim();
    const key = trimmed.toLowerCase();
    if (!seen.has(key) && trimmed.length >= 2) {
      seen.add(key);
      result.push(trimmed);
      if (result.length >= 4) break;
    }
  }

  return result;
}

export interface CandidateScoreResult {
  score: number;
  match: boolean;
  reason: string;
}

/**
 * Scores a candidate title against the target title with hard anti-collision guards.
 * Guaranteed to prevent sequel mismatches (e.g. Max Payne vs Max Payne 3, Dawn of War II vs III).
 */
export function scoreCandidate(
  targetTitle: string,
  candidateTitle: string,
  targetYear?: number | null,
  candidateYear?: number | null
): CandidateScoreResult {
  if (!targetTitle || !candidateTitle) {
    return { score: 0, match: false, reason: 'missing title' };
  }

  // Compare both raw and edition-stripped variations
  const targetStripped = stripEditionSuffixes(targetTitle);
  const candidateStripped = stripEditionSuffixes(candidateTitle);

  const nT = normalizeForMatch(targetStripped);
  const nC = normalizeForMatch(candidateStripped);

  if (!nT || !nC) {
    return { score: 0, match: false, reason: 'empty normalized title' };
  }

  // 1. Number / Sequel conflict check:
  // If target has numbers not in candidate, or candidate has numbers not in target -> REJECT
  const numsT = extractNumbers(nT);
  const numsC = extractNumbers(nC);

  for (const n of numsT) {
    if (!numsC.includes(n)) {
      return { score: 0, match: false, reason: `number mismatch: target has ${n}, candidate lacks it` };
    }
  }
  for (const n of numsC) {
    if (!numsT.includes(n)) {
      return { score: 0, match: false, reason: `number mismatch: candidate has ${n}, target lacks it` };
    }
  }

  // 2. Release year discrepancy check
  if (targetYear && candidateYear && !isNaN(targetYear) && !isNaN(candidateYear)) {
    const diff = Math.abs(targetYear - candidateYear);
    if (diff >= 8) {
      return { score: 0, match: false, reason: `release year gap too large: ${diff} years` };
    }
  }

  // 3. Exact match
  if (nT === nC) {
    return { score: 1.0, match: true, reason: 'exact normalized match' };
  }

  // 4. Similarity calculation
  const d = diceCoefficient(nT, nC);
  const wordsT = new Set(nT.split(' '));
  const wordsC = new Set(nC.split(' '));
  const j = jaccardSimilarity(wordsT, wordsC);

  let composite = 0.5 * d + 0.5 * j;

  // Remastered penalty if target did not specify remaster
  if (!nT.includes('remaster') && nC.includes('remaster')) {
    composite -= 0.25;
  }

  // Release year bonus / penalty
  if (targetYear && candidateYear && !isNaN(targetYear) && !isNaN(candidateYear)) {
    const diff = Math.abs(targetYear - candidateYear);
    if (diff <= 1) {
      composite += 0.05;
    } else if (diff >= 4) {
      composite -= 0.20;
    }
  }

  const finalScore = Math.max(0, Math.min(1.0, composite));
  const isMatch = finalScore >= 0.85;

  return {
    score: finalScore,
    match: isMatch,
    reason: isMatch ? `passed threshold (${finalScore.toFixed(3)})` : `below threshold (${finalScore.toFixed(3)})`
  };
}
