/**
 * Streamable, line-delimited (NDJSON) serialization of a {@link CorpusIndex}.
 *
 * Large corpora (tens of thousands of docs) produce an index whose single-string
 * JSON exceeds V8's maximum string length, breaking both `JSON.stringify` in the
 * ingest CLI and `JSON.parse`/`response.text()` in the browser. This format
 * writes/reads one small JSON record per line so neither side ever materializes
 * a giant string.
 *
 * Layout (one JSON object per line, in this order):
 *   1. manifest  {f, v, chunkCount, bm25:{k1,b,docCount,avgDocLength}}
 *   2. chunks    {k:'c', id, d:docId, t:title, x:text, u?:url, p:position, l:tokenLen}
 *   3. terms     {k:'w', w:term, p:[[chunkIndex, tf], ...]}   (chunkIndex saves space)
 *   4. vocab     {k:'v', t:term, n:normalized, h:phonetic, f:frequency}
 *
 * Terms reference chunks by their 0-based emission index, so chunks MUST precede
 * terms (they do); the assembler relies on that ordering.
 */
import type { Bm25IndexData, CorpusIndex, DocChunk, VocabularyEntry } from './types.ts';

export const INDEX_FORMAT = 'live-search-index';
export const INDEX_FORMAT_VERSION = 1;

/** Lazily yield each NDJSON line (without the trailing newline). */
export function* encodeIndexLines(index: CorpusIndex): Generator<string> {
  const chunkIndexById = new Map<string, number>();
  index.chunks.forEach((c, i) => chunkIndexById.set(c.id, i));

  yield JSON.stringify({
    f: INDEX_FORMAT,
    v: INDEX_FORMAT_VERSION,
    chunkCount: index.chunks.length,
    bm25: {
      k1: index.bm25.k1,
      b: index.bm25.b,
      docCount: index.bm25.docCount,
      avgDocLength: index.bm25.avgDocLength,
    },
  });

  for (const c of index.chunks) {
    const rec: Record<string, unknown> = {
      k: 'c',
      id: c.id,
      d: c.docId,
      t: c.title,
      x: c.text,
      p: c.position,
      l: index.bm25.docLengths[c.id] ?? 0,
    };
    if (c.url) rec.u = c.url;
    yield JSON.stringify(rec);
  }

  for (const term of Object.keys(index.bm25.postings)) {
    const postings = index.bm25.postings[term];
    const p: Array<[number, number]> = [];
    for (const posting of postings) {
      const idx = chunkIndexById.get(posting.id);
      if (idx !== undefined) p.push([idx, posting.tf]);
    }
    yield JSON.stringify({ k: 'w', w: term, p });
  }

  for (const e of index.vocabulary.entries) {
    yield JSON.stringify({ k: 'v', t: e.term, n: e.normalized, h: e.phonetic, f: e.frequency });
  }
}

interface ManifestRecord {
  f: string;
  v: number;
  bm25: { k1: number; b: number; docCount: number; avgDocLength: number };
}

/**
 * Reconstructs a {@link CorpusIndex} from NDJSON lines fed in order. Works for
 * both the Node CLI and the browser streaming loader.
 */
export class IndexAssembler {
  private manifest: ManifestRecord | null = null;
  private readonly chunks: DocChunk[] = [];
  private readonly docLengths: Record<string, number> = Object.create(null);
  private readonly postings: Bm25IndexData['postings'] = Object.create(null);
  private readonly vocab: VocabularyEntry[] = [];

  /** Feed one line (a JSON object). Blank lines are ignored. */
  addLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const rec = JSON.parse(trimmed) as Record<string, unknown>;

    if (rec.f === INDEX_FORMAT) {
      this.manifest = rec as unknown as ManifestRecord;
      return;
    }
    switch (rec.k) {
      case 'c': {
        const chunk: DocChunk = {
          id: rec.id as string,
          docId: rec.d as string,
          title: rec.t as string,
          text: rec.x as string,
          position: rec.p as number,
        };
        if (typeof rec.u === 'string') chunk.url = rec.u;
        this.chunks.push(chunk);
        this.docLengths[chunk.id] = (rec.l as number) ?? 0;
        break;
      }
      case 'w': {
        const pairs = rec.p as Array<[number, number]>;
        const list: Array<{ id: string; tf: number }> = [];
        for (const [idx, tf] of pairs) {
          const chunk = this.chunks[idx];
          if (chunk) list.push({ id: chunk.id, tf });
        }
        this.postings[rec.w as string] = list;
        break;
      }
      case 'v': {
        this.vocab.push({
          term: rec.t as string,
          normalized: rec.n as string,
          phonetic: rec.h as string,
          frequency: rec.f as number,
        });
        break;
      }
    }
  }

  /** Produce the finished index. Throws if the manifest line was missing. */
  finish(): CorpusIndex {
    if (!this.manifest || this.manifest.f !== INDEX_FORMAT) {
      throw new Error('Index manifest missing or invalid (not a live-search index file)');
    }
    const bm25: Bm25IndexData = {
      k1: this.manifest.bm25.k1,
      b: this.manifest.bm25.b,
      docCount: this.manifest.bm25.docCount,
      avgDocLength: this.manifest.bm25.avgDocLength,
      docLengths: this.docLengths,
      postings: this.postings,
    };
    return {
      version: this.manifest.v,
      chunks: this.chunks,
      bm25,
      vocabulary: { entries: this.vocab },
    };
  }
}

/** Split a buffer into complete lines, returning [lines, remainder]. */
export function splitLines(buffer: string): [string[], string] {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  return [lines, remainder];
}
