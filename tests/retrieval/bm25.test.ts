import { describe, it, expect } from 'vitest';
import { Bm25Index } from '../../src/retrieval/bm25.ts';
import { tokenize } from '../../src/retrieval/tokenize.ts';

function build(docs: Record<string, string>) {
  return Bm25Index.build(
    Object.entries(docs).map(([id, text]) => ({ id, tokens: tokenize(text) })),
    { k1: 1.5, b: 0.75 },
  );
}

const DOCS = {
  d1: 'the quick brown fox',
  d2: 'the lazy dog sleeps',
  d3: 'quick quick fox fox runs',
};

describe('Bm25Index', () => {
  it('ranks the doc with higher term frequency first', () => {
    const idx = build(DOCS);
    const hits = idx.search(tokenize('quick fox'));
    expect(hits[0].id).toBe('d3'); // repeats "quick" and "fox"
    expect(hits.map((h) => h.id)).toContain('d1');
    expect(hits.map((h) => h.id)).not.toContain('d2'); // no overlap
  });

  it('returns matched query terms per hit', () => {
    const idx = build(DOCS);
    const hits = idx.search(tokenize('quick dog'));
    const d1 = hits.find((h) => h.id === 'd1');
    expect(d1?.matched).toEqual(['quick']);
    const d2 = hits.find((h) => h.id === 'd2');
    expect(d2?.matched).toEqual(['dog']);
  });

  it('weights rare terms more heavily via IDF', () => {
    // "the" is in 2/3 docs (common); "runs" is in 1/3 (rare).
    const idx = build(DOCS);
    const common = idx.search(tokenize('the'));
    const rare = idx.search(tokenize('runs'));
    expect(rare[0].score).toBeGreaterThan(common[0].score);
  });

  it('honors topN', () => {
    const idx = build(DOCS);
    expect(idx.search(tokenize('quick fox'), 1)).toHaveLength(1);
  });

  it('returns nothing for an out-of-vocabulary query', () => {
    const idx = build(DOCS);
    expect(idx.search(tokenize('xylophone'))).toEqual([]);
  });

  it('round-trips through serialization', () => {
    const idx = build(DOCS);
    const restored = new Bm25Index(idx.data);
    const a = idx.search(tokenize('quick fox'));
    const b = restored.search(tokenize('quick fox'));
    expect(b).toEqual(a);
  });

  it('applies length normalization (b): shorter docs score higher for equal tf', () => {
    const idx = Bm25Index.build(
      [
        { id: 'short', tokens: tokenize('alpha beta') },
        { id: 'long', tokens: tokenize('alpha beta ' + 'filler '.repeat(50)) },
      ],
      { k1: 1.5, b: 0.75 },
    );
    const hits = idx.search(tokenize('alpha'));
    expect(hits[0].id).toBe('short');
  });
});
