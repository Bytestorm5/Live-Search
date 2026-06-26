// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { snippetToFragment, createResultCard, renderResults, formatScore } from '../../src/ui/render.ts';
import type { SearchHit } from '../../src/retrieval/types.ts';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunk: { id: 'd#0', docId: 'd', title: 'Doc Title', text: 'body', position: 0, charStart: 0, charEnd: 4 },
    score: 0.123456,
    snippet: 'see «AudioWorklet» here',
    matchedTerms: ['AudioWorklet'],
    lexicalScore: 1.2,
    semanticScore: 0.8,
    ...overrides,
  };
}

describe('snippetToFragment', () => {
  it('wraps highlighted spans in <mark> and keeps the rest as text', () => {
    const host = document.createElement('div');
    host.append(snippetToFragment('a «b» c «d»'));
    const marks = host.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('b');
    expect(marks[1].textContent).toBe('d');
    expect(host.textContent).toBe('a b c d');
  });

  it('escapes markup from the corpus (no injection)', () => {
    const host = document.createElement('div');
    host.append(snippetToFragment('<img src=x onerror=alert(1)> «safe»'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('mark')?.textContent).toBe('safe');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('formatScore', () => {
  it('formats to three decimals', () => {
    expect(formatScore(0.123456)).toBe('0.123');
  });
});

describe('createResultCard', () => {
  it('renders title, highlighted snippet, and score', () => {
    const card = createResultCard(hit());
    expect(card.querySelector('.result-title')?.textContent).toBe('Doc Title');
    expect(card.querySelector('mark')?.textContent).toBe('AudioWorklet');
    expect(card.querySelector('.result-score')?.textContent).toBe('0.123');
    expect(card.dataset.chunkId).toBe('d#0');
  });

  it('renders a link when the chunk has a url', () => {
    const card = createResultCard(hit({ chunk: { id: 'd#0', docId: 'd', title: 'T', text: 'b', position: 0, charStart: 0, charEnd: 1, url: 'https://x/y' } }));
    const a = card.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://x/y');
  });

  it('invokes onOpen when the card is activated', () => {
    const opened: SearchHit[] = [];
    const card = createResultCard(hit(), { onOpen: (h) => opened.push(h) });
    expect(card.getAttribute('role')).toBe('button');
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveLength(1);
    expect(opened[0].chunk.id).toBe('d#0');
  });

  it('does not let the external link also trigger onOpen', () => {
    const opened: SearchHit[] = [];
    const card = createResultCard(
      hit({ chunk: { id: 'd#0', docId: 'd', title: 'T', text: 'b', position: 0, charStart: 0, charEnd: 1, url: 'https://x/y' } }),
      { onOpen: (h) => opened.push(h) },
    );
    const link = card.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault()); // suppress jsdom navigation
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveLength(0);
  });
});

describe('renderResults', () => {
  it('shows an empty state when there are no hits', () => {
    const el = renderResults([]);
    expect(el.querySelector('.results-empty')).not.toBeNull();
  });
  it('renders one card per hit', () => {
    const el = renderResults([hit({ chunk: { id: 'a#0', docId: 'a', title: 'A', text: '', position: 0, charStart: 0, charEnd: 0 } }), hit({ chunk: { id: 'b#0', docId: 'b', title: 'B', text: '', position: 0, charStart: 0, charEnd: 0 } })]);
    expect(el.querySelectorAll('.result-card')).toHaveLength(2);
  });
});
