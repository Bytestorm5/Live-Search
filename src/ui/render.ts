/**
 * Pure DOM builders for the results panel (architecture spec §5.6).
 *
 * Kept free of app state so they can be unit-tested under happy-dom. All
 * documentation-derived text is inserted via `textContent` / text nodes, never
 * `innerHTML`, so a malicious corpus cannot inject markup into the page.
 */
import type { SearchHit } from '../retrieval/types.ts';

const SNIPPET_OPEN = '«';
const SNIPPET_CLOSE = '»';

export interface ResultCardOptions {
  /** Open the full source document for this hit (sidebar viewer, spec §5.6). */
  onOpen?: (hit: SearchHit) => void;
}

/**
 * Convert a snippet containing «highlight» markers into a DocumentFragment with
 * <mark> elements, escaping everything else by using text nodes.
 */
export function snippetToFragment(
  snippet: string,
  open = SNIPPET_OPEN,
  close = SNIPPET_CLOSE,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  let i = 0;
  while (i < snippet.length) {
    const o = snippet.indexOf(open, i);
    if (o === -1) {
      frag.append(document.createTextNode(snippet.slice(i)));
      break;
    }
    if (o > i) frag.append(document.createTextNode(snippet.slice(i, o)));
    const c = snippet.indexOf(close, o + open.length);
    if (c === -1) {
      frag.append(document.createTextNode(snippet.slice(o)));
      break;
    }
    const mark = document.createElement('mark');
    mark.textContent = snippet.slice(o + open.length, c);
    frag.append(mark);
    i = c + close.length;
  }
  return frag;
}

/** Format a fused relevance score for display. */
export function formatScore(score: number): string {
  return score.toFixed(3);
}

/** Build one result card. */
export function createResultCard(hit: SearchHit, opts: ResultCardOptions = {}): HTMLElement {
  const card = document.createElement('article');
  card.className = 'result-card';
  card.dataset.chunkId = hit.chunk.id;

  const header = document.createElement('header');
  header.className = 'result-header';

  const title = document.createElement('h3');
  title.className = 'result-title';
  if (hit.chunk.url) {
    const link = document.createElement('a');
    link.href = hit.chunk.url;
    link.textContent = hit.chunk.title;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    // The card itself opens the in-app viewer; the link is a separate escape
    // hatch to the source, so don't let it also trigger the card's onOpen.
    link.addEventListener('click', (e) => e.stopPropagation());
    title.append(link);
  } else {
    title.textContent = hit.chunk.title;
  }

  const score = document.createElement('span');
  score.className = 'result-score';
  score.textContent = formatScore(hit.score);
  score.title = [
    hit.lexicalScore !== undefined ? `lexical ${hit.lexicalScore.toFixed(3)}` : null,
    hit.semanticScore !== undefined ? `semantic ${hit.semanticScore.toFixed(3)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  header.append(title, score);

  const snippet = document.createElement('p');
  snippet.className = 'result-snippet';
  snippet.append(snippetToFragment(hit.snippet));

  card.append(header, snippet);

  if (opts.onOpen) {
    const open = opts.onOpen;
    card.classList.add('clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = 'Open the full document';
    card.append(makeOpenHint());
    card.addEventListener('click', () => open(hit));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(hit);
      }
    });
  }

  return card;
}

/** A small "open in viewer" affordance shown on clickable cards. */
function makeOpenHint(): HTMLElement {
  const hint = document.createElement('span');
  hint.className = 'result-open';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = 'Open ⤢';
  return hint;
}

/** Build the whole results list (or an empty-state message). */
export function renderResults(hits: SearchHit[], opts: ResultCardOptions = {}): HTMLElement {
  const list = document.createElement('div');
  list.className = 'results-list';
  if (hits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'results-empty';
    empty.textContent = 'No matching documentation yet — start speaking.';
    list.append(empty);
    return list;
  }
  for (const hit of hits) list.append(createResultCard(hit, opts));
  return list;
}
