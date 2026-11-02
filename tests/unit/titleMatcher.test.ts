import { describe, it, expect } from 'vitest';
import {
  stripEditionSuffixes,
  normalizeForMatch,
  extractNumbers,
  diceCoefficient,
  jaccardSimilarity,
  generateSearchQueryCandidates,
  scoreCandidate
} from '../../src/server/sources/titleMatcher.js';

describe('Title Matcher & Candidate Scoring Engine', () => {
  describe('stripEditionSuffixes', () => {
    it('strips trademarks, years, and bracketed edition indicators', () => {
      expect(stripEditionSuffixes('Call of Duty® 4: Modern Warfare® (2007)')).toBe('Call of Duty 4: Modern Warfare');
      expect(stripEditionSuffixes('TimeShift™')).toBe('TimeShift');
      expect(stripEditionSuffixes('Doom [Classic]')).toBe('Doom');
      expect(stripEditionSuffixes('Half-Life (Original)')).toBe('Half-Life');
    });

    it('strips common edition phrases cleanly', () => {
      expect(stripEditionSuffixes('Grand Theft Auto IV: The Complete Edition')).toBe('Grand Theft Auto IV');
      expect(stripEditionSuffixes('Warhammer 40,000: Dawn of War II - Anniversary Edition (Classic)')).toBe('Warhammer 40,000: Dawn of War II');
      expect(stripEditionSuffixes('Trine 2: Complete Story')).toBe('Trine 2');
      expect(stripEditionSuffixes('ENSLAVED™: Odyssey to the West™ Premium Edition')).toBe('ENSLAVED: Odyssey to the West');
      expect(stripEditionSuffixes('Gauntlet™ Slayer Edition')).toBe('Gauntlet');
      expect(stripEditionSuffixes('Divinity II: Developer\'s Cut')).toBe('Divinity II');
      expect(stripEditionSuffixes('Trine Enchanted Edition')).toBe('Trine');
      expect(stripEditionSuffixes('The Witcher 3: Wild Hunt - Game of the Year Edition')).toBe('The Witcher 3: Wild Hunt');
      expect(stripEditionSuffixes('Dark Souls: Prepare to Die Edition')).toBe('Dark Souls: Prepare to Die Edition'); // Prepare to die is not generic edition
    });

    it('handles multilingual slashed titles by taking the first portion', () => {
      expect(stripEditionSuffixes('Valiant Hearts: The Great War™ / Soldats Inconnus : Mémoires de la Grande Guerre™'))
        .toBe('Valiant Hearts: The Great War');
    });

    it('preserves distinct subtitles that are not edition words', () => {
      expect(stripEditionSuffixes('Call of Cthulhu®: Dark Corners of the Earth'))
        .toBe('Call of Cthulhu: Dark Corners of the Earth');
      expect(stripEditionSuffixes('Star Wars: Knights of the Old Republic'))
        .toBe('Star Wars: Knights of the Old Republic');
    });
  });

  describe('normalizeForMatch', () => {
    it('normalizes Roman numerals to digits', () => {
      expect(normalizeForMatch('FINAL FANTASY VIII')).toBe('final fantasy 8');
      expect(normalizeForMatch('Grand Theft Auto IV')).toBe('grand theft auto 4');
      expect(normalizeForMatch('Trine II')).toBe('trine 2');
      expect(normalizeForMatch('Civilization VI')).toBe('civilization 6');
    });

    it('normalizes commas in multi-digit numbers', () => {
      expect(normalizeForMatch('Warhammer 40,000: Dawn of War II')).toBe('warhammer 40000 dawn of war 2');
    });

    it('strips 4-digit release years while keeping numbers like 2077', () => {
      expect(normalizeForMatch('Cyberpunk 2077')).toBe('cyberpunk 2077');
      expect(normalizeForMatch('Grand Theft Auto IV (2008)')).toBe('grand theft auto 4');
    });

    it('normalizes ampersands to and', () => {
      expect(normalizeForMatch('Sherlock Holmes: Crimes & Punishments')).toBe('sherlock holmes crimes and punishments');
      expect(normalizeForMatch('Sherlock Holmes: Crimes and Punishments')).toBe('sherlock holmes crimes and punishments');
    });
  });

  describe('extractNumbers', () => {
    it('extracts unique numbers from normalized string', () => {
      expect(extractNumbers('warhammer 40000 dawn of war 2')).toEqual(['40000', '2']);
      expect(extractNumbers('max payne 3')).toEqual(['3']);
      expect(extractNumbers('max payne')).toEqual([]);
    });
  });

  describe('diceCoefficient & jaccardSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
      expect(diceCoefficient('cyberpunk', 'cyberpunk')).toBe(1.0);
      expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1.0);
    });

    it('returns 0.0 for completely disjoint strings', () => {
      expect(diceCoefficient('abcd', 'wxyz')).toBe(0.0);
      expect(jaccardSimilarity(new Set(['a']), new Set(['z']))).toBe(0.0);
    });
  });

  describe('generateSearchQueryCandidates', () => {
    it('generates prioritized candidate queries', () => {
      const candidates = generateSearchQueryCandidates('Grand Theft Auto IV: The Complete Edition');
      expect(candidates[0]).toBe('Grand Theft Auto IV');
      expect(candidates.some(c => c.includes('Grand Theft Auto IV'))).toBe(true);
      expect(candidates.length).toBeLessThanOrEqual(4);
    });

    it('generates ampersand variation when "and" is present', () => {
      const candidates = generateSearchQueryCandidates('Sherlock Holmes: Crimes and Punishments');
      expect(candidates.some(c => c.includes('&'))).toBe(true);
    });

    it('generates stripped author prefix variation', () => {
      const candidates = generateSearchQueryCandidates('Tom Clancy\'s Rainbow Six Vegas');
      expect(candidates.some(c => c === 'Rainbow Six Vegas')).toBe(true);
    });

    it('returns empty array for empty input', () => {
      expect(generateSearchQueryCandidates('')).toEqual([]);
      expect(generateSearchQueryCandidates('   ')).toEqual([]);
    });
  });

  describe('scoreCandidate Anti-Collision & Precision Verification', () => {
    it('hard rejects sequel number mismatches (Max Payne vs Max Payne 3)', () => {
      const res = scoreCandidate('Max Payne', 'Max Payne 3 (2015)', 2001, 2015);
      expect(res.match).toBe(false);
      expect(res.score).toBe(0);
      expect(res.reason).toContain('number mismatch');
    });

    it('hard rejects sequel number mismatches (Dawn of War II vs Dawn of War III)', () => {
      const res = scoreCandidate('Warhammer 40,000: Dawn of War II', 'Warhammer 40,000: Dawn of War III (2017)');
      expect(res.match).toBe(false);
      expect(res.score).toBe(0);
      expect(res.reason).toContain('number mismatch');
    });

    it('hard rejects prequel / missing number (Trine 2 vs Trine)', () => {
      const res = scoreCandidate('Trine 2', 'Trine');
      expect(res.match).toBe(false);
      expect(res.score).toBe(0);
      expect(res.reason).toContain('number mismatch');
    });

    it('hard rejects large release year gaps (Call of Cthulhu 2005 vs 2018)', () => {
      const res = scoreCandidate('Call of Cthulhu: Dark Corners of the Earth', 'Call of Cthulhu (2018)', 2005, 2018);
      expect(res.match).toBe(false);
      expect(res.score).toBe(0);
    });

    it('matches exact normalized game titles with score 1.0', () => {
      const res = scoreCandidate('Grand Theft Auto IV: The Complete Edition', 'Grand Theft Auto IV (2008)', 2008, 2008);
      expect(res.match).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it('matches ampersand variants perfectly', () => {
      const res = scoreCandidate('Sherlock Holmes: Crimes and Punishments', 'Sherlock Holmes: Crimes & Punishments (2014)', 2014, 2014);
      expect(res.match).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it('matches Roman numerals to digits perfectly', () => {
      const res = scoreCandidate('FINAL FANTASY VIII', 'Final Fantasy 8');
      expect(res.match).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it('penalizes remastered candidate when target is original game', () => {
      const resOriginal = scoreCandidate('Call of Duty 4: Modern Warfare', 'Call of Duty 4: Modern Warfare (2007)', 2007, 2007);
      const resRemaster = scoreCandidate('Call of Duty 4: Modern Warfare', 'Call of Duty 4: Modern Warfare Remastered (2016)', 2007, 2016);
      expect(resOriginal.score).toBeGreaterThan(resRemaster.score);
      expect(resOriginal.match).toBe(true);
      expect(resRemaster.match).toBe(false);
    });
  });

  describe('Comprehensive Accuracy Benchmark Suite (Target >= 95% Accuracy)', () => {
    interface BenchmarkCase {
      target: string;
      candidate: string;
      targetYear?: number;
      candidateYear?: number;
      expectedMatch: boolean;
      description: string;
    }

    const benchmarkCases: BenchmarkCase[] = [
      // 1-10: Positive Matches (Various editions, years, Roman numerals)
      { target: 'Grand Theft Auto IV: The Complete Edition', candidate: 'Grand Theft Auto IV (2008)', targetYear: 2008, candidateYear: 2008, expectedMatch: true, description: 'GTA IV Complete Edition' },
      { target: 'Call of Duty® 4: Modern Warfare® (2007)', candidate: 'Call of Duty 4: Modern Warfare (2007)', targetYear: 2007, candidateYear: 2007, expectedMatch: true, description: 'CoD 4 Modern Warfare' },
      { target: 'Warhammer 40,000: Dawn of War II - Anniversary Edition (Classic)', candidate: 'Warhammer 40,000: Dawn of War II', targetYear: 2009, candidateYear: 2009, expectedMatch: true, description: 'Dawn of War II Anniversary' },
      { target: 'Sherlock Holmes: Crimes and Punishments', candidate: 'Sherlock Holmes: Crimes & Punishments (2014)', targetYear: 2014, candidateYear: 2014, expectedMatch: true, description: 'Sherlock Holmes ampersand' },
      { target: 'FINAL FANTASY VIII', candidate: 'Final Fantasy 8', targetYear: 2000, candidateYear: 2000, expectedMatch: true, description: 'FF VIII Roman numeral' },
      { target: 'FINAL FANTASY®  XI: Ultimate Collection Seekers Edition', candidate: 'Final Fantasy 11', targetYear: 2003, candidateYear: 2003, expectedMatch: true, description: 'FF XI Seekers Edition' },
      { target: 'Trine 2: Complete Story', candidate: 'Trine 2 (2011)', targetYear: 2011, candidateYear: 2011, expectedMatch: true, description: 'Trine 2 Complete Story' },
      { target: 'ENSLAVED™: Odyssey to the West™ Premium Edition', candidate: 'ENSLAVED: Odyssey to the West', targetYear: 2010, candidateYear: 2010, expectedMatch: true, description: 'Enslaved Premium Edition' },
      { target: 'Divinity II: Developer\'s Cut', candidate: 'Divinity 2', targetYear: 2009, candidateYear: 2009, expectedMatch: true, description: 'Divinity II Developer Cut' },
      { target: 'Gauntlet™ Slayer Edition', candidate: 'Gauntlet (2014)', targetYear: 2014, candidateYear: 2014, expectedMatch: true, description: 'Gauntlet Slayer Edition' },
      
      // 11-20: Positive Matches (Subtitles, slashes, franchises)
      { target: 'Valiant Hearts: The Great War™ / Soldats Inconnus : Mémoires de la Grande Guerre™', candidate: 'Valiant Hearts: The Great War (2014)', targetYear: 2014, candidateYear: 2014, expectedMatch: true, description: 'Valiant Hearts multilingual' },
      { target: 'Max Payne', candidate: 'Max Payne (2001)', targetYear: 2001, candidateYear: 2001, expectedMatch: true, description: 'Max Payne 1' },
      { target: 'Max Payne 2: The Fall of Max Payne', candidate: 'Max Payne 2: The Fall of Max Payne', targetYear: 2003, candidateYear: 2003, expectedMatch: true, description: 'Max Payne 2' },
      { target: 'Max Payne 3', candidate: 'Max Payne 3 (2012)', targetYear: 2012, candidateYear: 2012, expectedMatch: true, description: 'Max Payne 3' },
      { target: 'Cyberpunk 2077', candidate: 'Cyberpunk 2077 (2020)', targetYear: 2020, candidateYear: 2020, expectedMatch: true, description: 'Cyberpunk 2077' },
      { target: 'The Witcher 3: Wild Hunt - Game of the Year Edition', candidate: 'The Witcher 3: Wild Hunt', targetYear: 2015, candidateYear: 2015, expectedMatch: true, description: 'Witcher 3 GOTY' },
      { target: 'Dark Souls: Remastered', candidate: 'Dark Souls: Remastered (2018)', targetYear: 2018, candidateYear: 2018, expectedMatch: true, description: 'Dark Souls Remastered' },
      { target: 'Civilization VI: Platinum Edition', candidate: 'Sid Meier\'s Civilization 6', targetYear: 2016, candidateYear: 2016, expectedMatch: true, description: 'Civ VI with author prefix' },
      { target: 'Far Cry®', candidate: 'Far Cry (2004)', targetYear: 2004, candidateYear: 2004, expectedMatch: true, description: 'Far Cry 1' },
      { target: 'Far Cry® 2', candidate: 'Far Cry 2 (2008)', targetYear: 2008, candidateYear: 2008, expectedMatch: true, description: 'Far Cry 2' },

      // 21-35: Negative Controls (Must NEVER match - sequels, reboots, spin-offs, DLCs)
      { target: 'Max Payne', candidate: 'Max Payne 3 (2015)', targetYear: 2001, candidateYear: 2015, expectedMatch: false, description: 'Max Payne 1 vs 3' },
      { target: 'Max Payne', candidate: 'Max Payne 2 (2003)', targetYear: 2001, candidateYear: 2003, expectedMatch: false, description: 'Max Payne 1 vs 2' },
      { target: 'Warhammer 40,000: Dawn of War II', candidate: 'Warhammer 40,000: Dawn of War III', targetYear: 2009, candidateYear: 2017, expectedMatch: false, description: 'Dawn of War II vs III' },
      { target: 'Warhammer 40,000: Dawn of War II', candidate: 'Warhammer 40,000: Dawn of War (2004)', targetYear: 2009, candidateYear: 2004, expectedMatch: false, description: 'Dawn of War II vs I' },
      { target: 'Trine', candidate: 'Trine 2 (2011)', targetYear: 2009, candidateYear: 2011, expectedMatch: false, description: 'Trine 1 vs 2' },
      { target: 'Trine 2', candidate: 'Trine 4: The Nightmare Prince', targetYear: 2011, candidateYear: 2019, expectedMatch: false, description: 'Trine 2 vs 4' },
      { target: 'Call of Cthulhu: Dark Corners of the Earth', candidate: 'Call of Cthulhu (2018)', targetYear: 2005, candidateYear: 2018, expectedMatch: false, description: 'Call of Cthulhu 2005 vs 2018 reboot' },
      { target: 'Doom', candidate: 'Doom II', targetYear: 1993, candidateYear: 1994, expectedMatch: false, description: 'Doom vs Doom II' },
      { target: 'Doom 3', candidate: 'Doom (2016)', targetYear: 2004, candidateYear: 2016, expectedMatch: false, description: 'Doom 3 vs Doom 2016' },
      { target: 'Star Wars Battlefront', candidate: 'Star Wars Battlefront II', targetYear: 2004, candidateYear: 2005, expectedMatch: false, description: 'Battlefront 1 vs II' },
      { target: 'Grand Theft Auto IV', candidate: 'Grand Theft Auto V', targetYear: 2008, candidateYear: 2013, expectedMatch: false, description: 'GTA IV vs GTA V' },
      { target: 'Far Cry 3', candidate: 'Far Cry 4', targetYear: 2012, candidateYear: 2014, expectedMatch: false, description: 'Far Cry 3 vs 4' },
      { target: 'Half-Life', candidate: 'Half-Life 2', targetYear: 1998, candidateYear: 2004, expectedMatch: false, description: 'Half-Life 1 vs 2' },
      { target: 'Portal', candidate: 'Portal 2', targetYear: 2007, candidateYear: 2011, expectedMatch: false, description: 'Portal 1 vs 2' },
      { target: 'Left 4 Dead', candidate: 'Left 4 Dead 2', targetYear: 2008, candidateYear: 2009, expectedMatch: false, description: 'Left 4 Dead 1 vs 2' },
    ];

    it('achieves >= 95% accuracy across the benchmark suite', () => {
      let correct = 0;
      const failures: string[] = [];

      for (const tc of benchmarkCases) {
        const result = scoreCandidate(tc.target, tc.candidate, tc.targetYear, tc.candidateYear);
        if (result.match === tc.expectedMatch) {
          correct++;
        } else {
          failures.push(`[${tc.description}] Target: "${tc.target}" vs Candidate: "${tc.candidate}". Expected match=${tc.expectedMatch}, Got match=${result.match} (score=${result.score.toFixed(3)}, reason=${result.reason})`);
        }
      }

      const accuracy = (correct / benchmarkCases.length) * 100;
      if (failures.length > 0) {
        // Output failures for diagnosis
        // eslint-disable-next-line no-console
        console.warn(`Benchmark failures (${failures.length}/${benchmarkCases.length}):\n` + failures.join('\n'));
      }

      expect(accuracy).toBeGreaterThanOrEqual(95);
      expect(correct).toBe(benchmarkCases.length); // Aiming for 100% on this benchmark!
    });
  });
});
