/**
 * Build the "known vocabulary" used for vocabulary-constrained correction
 * (architecture spec §5.4). At index-build time we collect product names, API
 * symbols, acronyms and other domain terms from the corpus; each entry carries a
 * normalized form and a phonetic key so the corrector can match fast.
 */
import type { VocabularyData, VocabularyEntry } from '../retrieval/types.ts';
import { phoneticKey } from './phonetic.ts';

/**
 * Build a {@link VocabularyData} from a stream of surface terms. Terms that
 * normalize to the same string are merged, keeping the most frequent surface
 * form as canonical and summing frequencies.
 */
export function buildVocabulary(terms: Iterable<string>): VocabularyData {
  // normalized -> { surfaceForm -> count }
  const groups = new Map<string, Map<string, number>>();

  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const normalized = term.toLowerCase();
    let surfaces = groups.get(normalized);
    if (!surfaces) {
      surfaces = new Map();
      groups.set(normalized, surfaces);
    }
    surfaces.set(term, (surfaces.get(term) ?? 0) + 1);
  }

  const entries: VocabularyEntry[] = [];
  for (const [normalized, surfaces] of groups) {
    let canonical = '';
    let best = -1;
    let frequency = 0;
    for (const [surface, count] of surfaces) {
      frequency += count;
      if (count > best || (count === best && surface < canonical)) {
        best = count;
        canonical = surface;
      }
    }
    entries.push({
      term: canonical,
      normalized,
      phonetic: phoneticKey(normalized),
      frequency,
    });
  }

  // Stable order: most frequent first, then alphabetical.
  entries.sort((a, b) => b.frequency - a.frequency || (a.normalized < b.normalized ? -1 : 1));
  return { entries };
}
