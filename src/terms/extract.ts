/**
 * Candidate query-term extraction (architecture spec §4 step 4, §5.4).
 *
 * From a committed utterance we pull the tokens worth searching on: capitalized
 * words, ALL-CAPS acronyms, code-like identifiers, content words (non-stopwords
 * of reasonable length), and adjacent content-word bigrams (to catch multi-word
 * terms such as "audio worklet"). We deliberately keep surface forms — the
 * corrector (§5.4) decides what to map to known vocabulary next.
 */
import { STOPWORDS } from '../retrieval/tokenize.ts';

export interface ExtractOptions {
  /** Ignore content words shorter than this. */
  minLength?: number;
  /** Emit adjacent content-word bigrams in addition to unigrams. */
  includeBigrams?: boolean;
  /**
   * Optional rarity oracle. A capitalized/identifier token is only treated as a
   * salient proper noun if it is NOT common in the corpus — so frequent words
   * like "Wonderful" at the start of a sentence aren't mistaken for domain terms
   * (spec §5.4). Receives the lowercased token.
   */
  isCommon?: (lowerToken: string) => boolean;
}

/** A surface token, distinguishing code identifiers from proper nouns. */
interface Surface {
  raw: string;
  lower: string;
  /** camelCase / dotted / symbol — always meaningful regardless of rarity. */
  identifier: boolean;
  /** Capitalized word or acronym — a proper noun ONLY if rare in the corpus. */
  properNoun: boolean;
}

function splitSurfaces(text: string): Surface[] {
  // Split on whitespace and sentence punctuation, but keep intra-word symbols
  // like '.' and '-' inside identifiers (navigator.gpu, whisper-base.en).
  const rawTokens = text.split(/[\s,;:!?()[\]{}"']+/).filter(Boolean);
  const out: Surface[] = [];
  for (const tokRaw of rawTokens) {
    // Trim leading/trailing punctuation that isn't part of the token.
    const tok = tokRaw.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!tok) continue;
    const lower = tok.toLowerCase();
    const isCapitalized = /^[A-Z][a-z]+/.test(tok);
    const isAcronym = /^[A-Z0-9]{2,}$/.test(tok);
    const isIdentifier = /[a-z][A-Z]|[A-Za-z][0-9]|[0-9][A-Za-z]|[._-]/.test(tok);
    out.push({ raw: tok, lower, identifier: isIdentifier, properNoun: isCapitalized || isAcronym });
  }
  return out;
}

export function extractCandidateTerms(text: string, opts: ExtractOptions = {}): string[] {
  const minLength = opts.minLength ?? 3;
  const includeBigrams = opts.includeBigrams ?? true;
  const isCommon = opts.isCommon ?? (() => false);
  const surfaces = splitSurfaces(text);

  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      ordered.push(term);
    }
  };

  // A token is salient if it's a code identifier, or a proper noun that is rare
  // in the corpus (common capitalized words are NOT salient).
  const salient = (s: Surface) => s.identifier || (s.properNoun && !isCommon(s.lower));
  const isContent = (s: Surface) =>
    salient(s) || (s.lower.length >= minLength && !STOPWORDS.has(s.lower));

  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    if (isContent(s)) add(s.raw);
    if (includeBigrams && i + 1 < surfaces.length) {
      const next = surfaces[i + 1];
      if (isContent(s) && isContent(next)) add(`${s.raw} ${next.raw}`);
    }
  }

  return ordered;
}

/** True if a candidate term is a salient proper noun / identifier (rarity-aware). */
export function isSalientTerm(token: string, isCommon: (lower: string) => boolean = () => false): boolean {
  const [s] = splitSurfaces(token);
  if (!s) return false;
  return s.identifier || (s.properNoun && !isCommon(s.lower));
}
