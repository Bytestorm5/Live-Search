/**
 * Phonetic keying for sound-alike matching (architecture spec §5.4).
 *
 * When the ASR mistranscribes a domain term it usually still *sounds* like the
 * real term ("moonshyne" -> "Moonshine"). Comparing Soundex-style phonetic keys
 * catches those even when edit distance alone is borderline.
 *
 * {@link soundex} is the classic 4-character code (handy to verify against
 * published values); {@link phoneticKey} keeps the full digit run for better
 * discrimination on long technical terms.
 */

const CODES: Record<string, string> = {
  B: '1', F: '1', P: '1', V: '1',
  C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
  D: '3', T: '3',
  L: '4',
  M: '5', N: '5',
  R: '6',
};

/** Shared encoder. `truncate` => classic 4-char Soundex; otherwise full key. */
function encode(word: string, truncate: boolean): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 0) return '';

  let out = s[0];
  let prev = CODES[s[0]] ?? '';
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === 'H' || ch === 'W') {
      // h/w do not break a run: two same-coded letters around them collapse.
      continue;
    }
    const code = CODES[ch];
    if (code === undefined) {
      // Vowel (or Y): a separator — the next same code IS recorded.
      prev = '';
      continue;
    }
    if (code !== prev) {
      out += code;
      if (truncate && out.length >= 4) break;
    }
    prev = code;
  }
  return truncate ? (out + '000').slice(0, 4) : out;
}

/** Classic 4-character Soundex code, e.g. "Robert" -> "R163". */
export function soundex(word: string): string {
  return encode(word, true);
}

/** Full (untruncated, unpadded) phonetic key for fuzzy matching. */
export function phoneticKey(word: string): string {
  return encode(word, false);
}
