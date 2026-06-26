/**
 * Vocabulary-constrained correction (architecture spec §5.4).
 *
 * "This stage is what makes the system robust despite small on-device models
 * making mistakes on jargon." A mistranscribed term that is close (by edit
 * distance or phonetics) to a *known doc term* is repaired to it before
 * querying. Corrections are constrained to terms that exist in the corpus, so
 * the retrieval trigger tolerates ASR errors without inventing spurious matches.
 * The verbatim transcript shown to the operator stays uncorrected — only the
 * query path is corrected (§5.4).
 */
import type { VocabularyData, VocabularyEntry } from '../retrieval/types.ts';
import type { CorrectionConfig } from '../config.ts';
import { damerauLevenshtein } from './editDistance.ts';
import { phoneticKey } from './phonetic.ts';

export interface Correction {
  /** The term to use for querying (canonical vocab form, or the input). */
  term: string;
  /** True if the term was changed from the input. */
  corrected: boolean;
  /** How the match was made. */
  source: 'exact' | 'fuzzy' | 'phonetic' | 'none';
  /** Normalized similarity to the matched vocab term (1 for exact). */
  similarity: number;
}

export class VocabularyCorrector {
  private readonly cfg: CorrectionConfig;
  private readonly byNormalized = new Map<string, VocabularyEntry>();
  private readonly byPhonetic = new Map<string, VocabularyEntry[]>();
  private readonly entries: VocabularyEntry[];

  constructor(vocab: VocabularyData, cfg: CorrectionConfig) {
    this.cfg = cfg;
    this.entries = vocab.entries;
    for (const e of vocab.entries) {
      if (!this.byNormalized.has(e.normalized)) this.byNormalized.set(e.normalized, e);
      if (e.phonetic) {
        const bucket = this.byPhonetic.get(e.phonetic);
        if (bucket) bucket.push(e);
        else this.byPhonetic.set(e.phonetic, [e]);
      }
    }
  }

  /** Correct a single candidate term against the known vocabulary. */
  correct(term: string): Correction {
    const spaced = term.toLowerCase();
    const joined = spaced.replace(/\s+/g, '');
    if (joined.length < this.cfg.minTermLength) {
      return { term, corrected: false, source: 'none', similarity: 0 };
    }

    // 1. Exact match (with or without internal spaces, e.g. "audio worklet").
    const exact = this.byNormalized.get(spaced) ?? this.byNormalized.get(joined);
    if (exact) {
      return { term: exact.term, corrected: exact.term !== term, source: 'exact', similarity: 1 };
    }

    // 2. Fuzzy / phonetic match over a pruned candidate set.
    const pk = phoneticKey(joined);
    const candidates = this.candidatesFor(joined, pk);

    let best: VocabularyEntry | null = null;
    let bestSim = -1;
    let bestPhonetic = false;
    for (const cand of candidates) {
      const dist = damerauLevenshtein(joined, cand.normalized);
      if (dist > this.cfg.maxEditDistance) continue;
      const sim = 1 - dist / Math.max(joined.length, cand.normalized.length);
      const phoneticMatch = pk !== '' && cand.phonetic === pk;
      if (sim < this.cfg.minSimilarity && !phoneticMatch) continue;
      // Prefer higher similarity, then a phonetic match, then corpus frequency.
      if (
        sim > bestSim ||
        (sim === bestSim && phoneticMatch && !bestPhonetic) ||
        (sim === bestSim && phoneticMatch === bestPhonetic && cand.frequency > (best?.frequency ?? -1))
      ) {
        best = cand;
        bestSim = sim;
        bestPhonetic = phoneticMatch;
      }
    }

    if (best) {
      return {
        term: best.term,
        corrected: best.term !== term,
        source: bestPhonetic && bestSim < this.cfg.minSimilarity ? 'phonetic' : 'fuzzy',
        similarity: bestSim,
      };
    }
    return { term, corrected: false, source: 'none', similarity: 0 };
  }

  /** Correct a list of candidate terms (the query path). */
  correctTerms(terms: string[]): string[] {
    return terms.map((t) => this.correct(t).term);
  }

  /** Detailed corrections for a list (useful for debugging / UI). */
  correctAll(terms: string[]): Correction[] {
    return terms.map((t) => this.correct(t));
  }

  /** Prune to entries reachable by phonetics or within the length window. */
  private candidatesFor(joined: string, pk: string): VocabularyEntry[] {
    const set = new Set<VocabularyEntry>();
    const bucket = this.byPhonetic.get(pk);
    if (bucket) for (const e of bucket) set.add(e);
    const maxDist = this.cfg.maxEditDistance;
    for (const e of this.entries) {
      if (Math.abs(e.normalized.length - joined.length) <= maxDist) set.add(e);
    }
    return [...set];
  }
}
