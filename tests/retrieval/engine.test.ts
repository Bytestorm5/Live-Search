import { describe, it, expect } from 'vitest';
import { RetrievalEngine } from '../../src/retrieval/engine.ts';
import { buildIndex, withEmbeddings } from '../../src/retrieval/ingest.ts';
import { embedChunks, type EmbeddingModel } from '../../src/retrieval/embedding.ts';
import { tokenize } from '../../src/retrieval/tokenize.ts';
import { makeConfig } from '../../src/config.ts';
import type { RawDoc } from '../../src/retrieval/types.ts';

/**
 * Deterministic bag-of-words embedder: dimensions are hashed token buckets, so
 * texts that share words get similar vectors. Enough to exercise the semantic
 * path + fusion plumbing without downloading a real model.
 */
class FakeEmbedder implements EmbeddingModel {
  readonly id = 'fake-bow-16';
  readonly dim = 16;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(this.dim).fill(0);
      for (const tok of tokenize(t)) {
        let h = 0;
        for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        v[h % this.dim] += 1;
      }
      return v;
    });
  }
}

const docs: RawDoc[] = [
  { id: 'asr', title: 'Speech Recognition', text: 'Moonshine is a fast ASR model. It runs locally with WebGPU and getUserMedia.' },
  { id: 'vad', title: 'Voice Activity', text: 'Silero VAD detects speech and silence and segments utterances cleanly.' },
  { id: 'retr', title: 'Retrieval', text: 'BM25 lexical search and vector embeddings power hybrid documentation retrieval.' },
];
const config = makeConfig({ retrieval: { chunkSizeTokens: 50, chunkOverlapTokens: 10, topK: 3 } });

describe('RetrievalEngine (lexical-only)', () => {
  it('retrieves the right chunk and highlights the matched term', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config });
    expect(engine.hasSemantic).toBe(false);
    const hits = await engine.query({ terms: ['Moonshine'], transcriptWindow: '', k: 3 });
    expect(hits[0].chunk.docId).toBe('asr');
    expect(hits[0].lexicalScore).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain('«Moonshine»');
  });

  it('returns nothing for a query with no lexical hits and no semantics', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config });
    expect(await engine.query({ terms: ['unrelatedxyz'], transcriptWindow: '', k: 3 })).toEqual([]);
  });

  it('applies vocabulary-constrained correction before retrieval', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config });
    const corrected = engine.correct(['moonshyne']); // mistranscription
    expect(corrected).toEqual(['Moonshine']);
    const hits = await engine.query({ terms: corrected, transcriptWindow: '', k: 3 });
    expect(hits[0].chunk.docId).toBe('asr');
  });

  it('honors k and excludeChunkIds (de-dup against on-screen results)', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config });
    const all = await engine.query({ terms: ['speech'], transcriptWindow: '', k: 3 });
    expect(all.length).toBeLessThanOrEqual(3);
    const top = all[0].chunk.id;
    const excluded = await engine.query({ terms: ['speech'], transcriptWindow: '', k: 3, excludeChunkIds: [top] });
    expect(excluded.map((h) => h.chunk.id)).not.toContain(top);
  });
});

describe('RetrievalEngine (hybrid)', () => {
  it('uses precomputed embeddings for semantic scoring and fuses with lexical', async () => {
    const base = buildIndex(docs, config);
    const embedder = new FakeEmbedder();
    const emb = await embedChunks(base.chunks, embedder);
    const engine = new RetrievalEngine({ index: withEmbeddings(base, emb), config, embedder });
    expect(engine.hasSemantic).toBe(true);

    const hits = await engine.query({ terms: ['BM25'], transcriptWindow: 'hybrid documentation retrieval', k: 3 });
    expect(hits[0].chunk.docId).toBe('retr');
    expect(hits[0].semanticScore).toBeDefined();
    expect(hits[0].lexicalScore).toBeDefined();
  });

  it('init() builds the semantic index by embedding chunks when none were precomputed', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config, embedder: new FakeEmbedder() });
    expect(engine.hasSemantic).toBe(false);
    await engine.init();
    expect(engine.hasSemantic).toBe(true);
    const hits = await engine.query({ terms: [], transcriptWindow: 'silence detection and utterances', k: 3 });
    expect(hits.length).toBeGreaterThan(0); // semantic-only query (no lexical terms) still returns
  });
});
