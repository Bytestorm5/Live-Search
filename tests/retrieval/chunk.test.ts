import { describe, it, expect } from 'vitest';
import { chunkDocument, chunkCorpus } from '../../src/retrieval/chunk.ts';
import type { RawDoc } from '../../src/retrieval/types.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('chunkDocument', () => {
  it('returns a single chunk for a short doc', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: words(5) };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 10, chunkOverlapTokens: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(words(5));
    expect(chunks[0].id).toBe('d#0');
    expect(chunks[0].position).toBe(0);
  });

  it('splits into overlapping chunks', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: words(10) };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 4, chunkOverlapTokens: 1 });
    // step = 3 -> windows [0,4) [3,7) [6,10)
    expect(chunks.map((c) => c.text)).toEqual([
      'w0 w1 w2 w3',
      'w3 w4 w5 w6',
      'w6 w7 w8 w9',
    ]);
    expect(chunks.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it('shares the overlap tokens between adjacent chunks', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: words(6) };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 3, chunkOverlapTokens: 1 });
    const last0 = chunks[0].text.split(' ').at(-1);
    const first1 = chunks[1].text.split(' ')[0];
    expect(last0).toBe(first1);
  });

  it('preserves original text spans verbatim', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: 'Hello,   world!  How are you?' };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 2, chunkOverlapTokens: 0 });
    expect(chunks[0].text).toBe('Hello,   world!');
  });

  it('records char offsets that slice the parent text back to the chunk', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: 'Hello,   world!  How are you?' };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 2, chunkOverlapTokens: 0 });
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe('Hello,   world!'.length);
    for (const c of chunks) {
      expect(doc.text.slice(c.charStart, c.charEnd)).toBe(c.text);
    }
  });

  it('carries url metadata onto chunks', () => {
    const doc: RawDoc = { id: 'd', title: 'T', text: words(3), url: 'https://x/y' };
    const chunks = chunkDocument(doc, { chunkSizeTokens: 5, chunkOverlapTokens: 0 });
    expect(chunks[0].url).toBe('https://x/y');
  });

  it('returns no chunks for empty or whitespace-only docs', () => {
    expect(chunkDocument({ id: 'd', title: 'T', text: '' }, { chunkSizeTokens: 5, chunkOverlapTokens: 0 })).toEqual([]);
    expect(chunkDocument({ id: 'd', title: 'T', text: '   \n  ' }, { chunkSizeTokens: 5, chunkOverlapTokens: 0 })).toEqual([]);
  });

  it('chunkCorpus concatenates chunks from all docs', () => {
    const docs: RawDoc[] = [
      { id: 'a', title: 'A', text: words(3) },
      { id: 'b', title: 'B', text: words(3) },
    ];
    const chunks = chunkCorpus(docs, { chunkSizeTokens: 5, chunkOverlapTokens: 0 });
    expect(chunks.map((c) => c.docId)).toEqual(['a', 'b']);
  });
});
