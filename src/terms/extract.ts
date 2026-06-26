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
}

/** A surface token with a flag for "looks like a name/identifier". */
interface Surface {
  raw: string;
  lower: string;
  salient: boolean;
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
    out.push({ raw: tok, lower, salient: isCapitalized || isAcronym || isIdentifier });
  }
  return out;
}

export function extractCandidateTerms(text: string, opts: ExtractOptions = {}): string[] {
  const minLength = opts.minLength ?? 3;
  const includeBigrams = opts.includeBigrams ?? true;
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

  const isContent = (s: Surface) =>
    s.salient || (s.lower.length >= minLength && !STOPWORDS.has(s.lower));

  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    // Salient tokens always qualify; otherwise require content-word criteria.
    if (s.salient || (s.lower.length >= minLength && !STOPWORDS.has(s.lower))) {
      add(s.raw);
    }
    if (includeBigrams && i + 1 < surfaces.length) {
      const next = surfaces[i + 1];
      if (isContent(s) && isContent(next)) {
        add(`${s.raw} ${next.raw}`);
      }
    }
  }

  return ordered;
}
