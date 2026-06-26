/**
 * Text tokenization shared by the lexical index and query path (spec §5.5).
 *
 * Indexing and querying MUST tokenize the same way, so both go through
 * {@link tokenize}. Identifier splitting ({@link splitIdentifier}) is used when
 * building the known vocabulary so a spoken "get user media" can still reach the
 * symbol `getUserMedia` (spec §5.4).
 */

/** Lowercase and split on any run of non-alphanumeric characters. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  let cur = '';
  for (let i = 0; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    const isAlnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57); // a-z 0-9
    if (isAlnum) {
      cur += lower[i];
    } else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Split a programming identifier into its lowercased word parts:
 * camelCase, PascalCase, ACRONYMs, snake_case, kebab-case, dotted, and
 * letter/digit boundaries.
 */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord -> ACRONYM Word
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2') // letter -> digit
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2') // digit -> letter
    .split(/[\s_\-./]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());
}

/** Common English function words; removed from query terms to reduce noise. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me',
  'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out', 'over', 'said', 'she', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

/** Drop stopwords from a token list. */
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t));
}
