import { describe, it, expect } from 'vitest';
import { buildIndex, withEmbeddings, INDEX_VERSION } from '../../src/retrieval/ingest.ts';
import { makeConfig } from '../../src/config.ts';
import type { RawDoc } from '../../src/retrieval/types.ts';

const docs: RawDoc[] = [
  { id: 'asr', title: 'Speech Recognition', text: 'Moonshine is a fast ASR model that runs locally with WebGPU.' },
  { id: 'vad', title: 'Voice Activity Detection', text: 'Silero VAD detects speech and silence to segment utterances.' },
];
const config = makeConfig({ retrieval: { chunkSizeTokens: 8, chunkOverlapTokens: 2 } });

describe('buildIndex', () => {
  it('produces a versioned index with chunks, BM25, and vocabulary', () => {
    const idx = buildIndex(docs, config);
    expect(idx.version).toBe(INDEX_VERSION);
    expect(idx.chunks.length).toBeGreaterThan(0);
    expect(idx.bm25.docCount).toBe(idx.chunks.length);
    expect(idx.embeddings).toBeUndefined();
  });

  it('extracts domain terms (product names, acronyms, identifiers) into the vocabulary', () => {
    const idx = buildIndex(docs, config);
    const norms = new Set(idx.vocabulary.entries.map((e) => e.normalized));
    expect(norms.has('moonshine')).toBe(true);
    expect(norms.has('webgpu')).toBe(true);
    expect(norms.has('silero')).toBe(true);
  });

  it('chunk ids are unique', () => {
    const idx = buildIndex(docs, config);
    const ids = idx.chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('withEmbeddings', () => {
  it('attaches embeddings aligned to chunks', () => {
    const idx = buildIndex(docs, config);
    const vectors = idx.chunks.map(() => [1, 0, 0]);
    const withEmb = withEmbeddings(idx, { dim: 3, vectors, modelId: 'fake' });
    expect(withEmb.embeddings?.vectors).toHaveLength(idx.chunks.length);
  });

  it('rejects a length mismatch', () => {
    const idx = buildIndex(docs, config);
    expect(() => withEmbeddings(idx, { dim: 3, vectors: [[1, 0, 0]], modelId: 'fake' })).toThrow();
  });
});
