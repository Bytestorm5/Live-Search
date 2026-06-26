import { describe, it, expect } from 'vitest';
import { encodeIndexLines, IndexAssembler, splitLines } from '../../src/retrieval/indexFormat.ts';
import { buildIndex } from '../../src/retrieval/ingest.ts';
import { Bm25Index } from '../../src/retrieval/bm25.ts';
import { tokenize } from '../../src/retrieval/tokenize.ts';
import { makeConfig } from '../../src/config.ts';
import type { RawDoc } from '../../src/retrieval/types.ts';

const docs: RawDoc[] = [
  { id: 'asr', title: 'Speech Recognition', text: 'Moonshine is a fast ASR model that runs locally with WebGPU.', url: 'https://x/asr' },
  { id: 'vad', title: 'Voice Activity Detection', text: 'Silero VAD detects speech and silence to segment utterances.' },
];
const config = makeConfig({ retrieval: { chunkSizeTokens: 8, chunkOverlapTokens: 2 } });

function roundTrip(index: ReturnType<typeof buildIndex>) {
  const assembler = new IndexAssembler();
  for (const line of encodeIndexLines(index)) assembler.addLine(line);
  return assembler.finish();
}

describe('NDJSON index round-trip', () => {
  it('reconstructs chunks, urls, offsets, and the manifest version', () => {
    const original = buildIndex(docs, config);
    const restored = roundTrip(original);
    expect(restored.version).toBe(original.version);
    expect(restored.chunks).toEqual(original.chunks); // includes charStart/charEnd
    expect(restored.chunks.find((c) => c.docId === 'asr')?.url).toBe('https://x/asr');
  });

  it('reconstructs the full documents for the sidebar viewer', () => {
    const original = buildIndex(docs, config);
    const restored = roundTrip(original);
    expect(restored.docs).toEqual(original.docs);
    const asr = restored.docs.find((d) => d.id === 'asr');
    expect(asr?.text).toContain('Moonshine is a fast ASR model');
    expect(asr?.url).toBe('https://x/asr');
  });

  it('stores chunk text once: offset records, not duplicated text', () => {
    const index = buildIndex(docs, config);
    const recs = [...encodeIndexLines(index)].map((l) => JSON.parse(l));
    const chunkRecs = recs.filter((r) => r.k === 'c');
    const docRecs = recs.filter((r) => r.k === 'd');
    expect(chunkRecs.length).toBe(index.chunks.length);
    expect(docRecs.length).toBe(index.docs.length);
    for (const c of chunkRecs) {
      expect(c.x).toBeUndefined(); // no per-chunk text
      expect(typeof c.cs).toBe('number');
      expect(typeof c.ce).toBe('number');
    }
    // A chunk's text is recovered by slicing its parent document.
    const restored = roundTrip(index);
    const c0 = restored.chunks[0];
    const parent = restored.docs.find((d) => d.id === c0.docId)!;
    expect(parent.text.slice(c0.charStart, c0.charEnd)).toBe(c0.text);
  });

  it('preserves BM25 search results exactly', () => {
    const original = buildIndex(docs, config);
    const restored = roundTrip(original);
    const a = new Bm25Index(original.bm25).search(tokenize('Moonshine WebGPU'));
    const b = new Bm25Index(restored.bm25).search(tokenize('Moonshine WebGPU'));
    expect(b).toEqual(a);
    expect(b[0].id).toContain('asr');
  });

  it('preserves the vocabulary', () => {
    const original = buildIndex(docs, config);
    const restored = roundTrip(original);
    const norms = new Set(restored.vocabulary.entries.map((e) => e.normalized));
    expect(norms.has('moonshine')).toBe(true);
    expect(norms.has('webgpu')).toBe(true);
    expect(restored.vocabulary.entries.length).toBe(original.vocabulary.entries.length);
  });

  it('first emitted line is the manifest', () => {
    const [first] = [...encodeIndexLines(buildIndex(docs, config))];
    expect(JSON.parse(first).f).toBe('live-search-index');
  });

  it('finish() throws without a manifest', () => {
    const a = new IndexAssembler();
    a.addLine(JSON.stringify({ k: 'c', id: 'x#0', d: 'x', t: 'T', x: 'body', p: 0, l: 1 }));
    expect(() => a.finish()).toThrow();
  });

  it('tolerates being fed line-by-line with a streaming splitter', () => {
    const index = buildIndex(docs, config);
    const blob = [...encodeIndexLines(index)].join('\n') + '\n';
    const assembler = new IndexAssembler();
    // Feed in arbitrary byte-ish chunks to mimic a network stream.
    let buf = '';
    for (let i = 0; i < blob.length; i += 7) {
      buf += blob.slice(i, i + 7);
      const [lines, remainder] = splitLines(buf);
      for (const l of lines) assembler.addLine(l);
      buf = remainder;
    }
    if (buf.trim()) assembler.addLine(buf);
    expect(assembler.finish().chunks.length).toBe(index.chunks.length);
  });
});
