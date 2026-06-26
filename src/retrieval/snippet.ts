/**
 * Snippet extraction for the results panel (architecture spec §5.6: "matched
 * snippet"). Finds the tightest window of a chunk that contains the query terms
 * and marks each matched term with «guillemets» so the UI can highlight it.
 */

export interface SnippetOptions {
  /** Maximum snippet length in characters. */
  maxLength?: number;
  /** Wrappers placed around each matched term. */
  open?: string;
  close?: string;
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeSnippet(text: string, terms: string[], opts: SnippetOptions = {}): string {
  const maxLength = opts.maxLength ?? 180;
  const open = opts.open ?? '«';
  const close = opts.close ?? '»';

  const cleanTerms = terms.map((t) => t.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  // Find the earliest occurrence of any term to center the window on.
  let firstHit = -1;
  for (const term of cleanTerms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && (firstHit === -1 || idx < firstHit)) firstHit = idx;
  }

  let windowText: string;
  let prefix = '';
  let suffix = '';
  if (firstHit === -1 || text.length <= maxLength) {
    windowText = text.slice(0, maxLength);
    if (text.length > maxLength) suffix = '…';
  } else {
    let start = Math.max(0, firstHit - Math.floor(maxLength / 3));
    let end = Math.min(text.length, start + maxLength);
    start = Math.max(0, end - maxLength);
    // Snap to word boundaries so we don't cut mid-word.
    if (start > 0) {
      const sp = text.indexOf(' ', start);
      if (sp !== -1 && sp < firstHit) start = sp + 1;
      prefix = '…';
    }
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > firstHit) end = sp;
      suffix = '…';
    }
    windowText = text.slice(start, end);
  }

  // Highlight matched terms in a single pass. Alternatives are sorted longest
  // first so the regex prefers the longest match at each position and we never
  // nest a short term inside an already-wrapped longer one.
  if (cleanTerms.length === 0) return prefix + windowText + suffix;
  const alternation = [...cleanTerms]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const re = new RegExp(`(${alternation})`, 'gi');
  const highlighted = windowText.replace(re, (match) => `${open}${match}${close}`);

  return prefix + highlighted + suffix;
}
