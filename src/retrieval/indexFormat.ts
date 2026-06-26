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
 *   2. docs      {k:'d', id, t:title, x:text, u?:url, m?:meta}   (full document text)
 *   3. chunks    {k:'c', id, d:docId, cs:charStart, ce:charEnd, p:position, l:tokenLen}
 *   4. terms     {k:'w', w:term, p:[[chunkIndex, tf], ...]}   (chunkIndex saves space)
 *   5. vocab     {k:'v', t:term, n:normalized, h:phonetic, f:frequency}
 *
 * A chunk's text/title/url are NOT stored per chunk; they are derived from the
 * parent document by slicing [charStart, charEnd). So full text is stored ONCE
 * (and `String.prototype.slice` shares the backing store, keeping chunk text
 * cheap in memory). Docs MUST therefore precede chunks, and chunks MUST precede
 * terms (terms reference chunks by 0-based emission index). The assembler relies
 * on this ordering.
 */
import type {
  Bm25IndexData,
  CorpusIndex,
  DocChunk,
  DocEntry,
  VocabularyEntry,
} from './types.ts';

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
    docCount: index.docs.length,
    bm25: {
      k1: index.bm25.k1,
      b: index.bm25.b,
      docCount: index.bm25.docCount,
      avgDocLength: index.bm25.avgDocLength,
    },
  });

  // Full documents first: chunks slice their text out of these by offset.
  for (const d of index.docs) {
    const rec: Record<string, unknown> = { k: 'd', id: d.id, t: d.title, x: d.text };
    if (d.url) rec.u = d.url;
    if (d.meta && Object.keys(d.meta).length) rec.m = d.meta;
    yield JSON.stringify(rec);
  }

  for (const c of index.chunks) {
    // title/url/text are derived from the parent doc on load, so omit them here.
    yield JSON.stringify({
      k: 'c',
      id: c.id,
      d: c.docId,
      cs: c.charStart,
      ce: c.charEnd,
      p: c.position,
      l: index.bm25.docLengths[c.id] ?? 0,
    });
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
  private readonly docs: DocEntry[] = [];
  private readonly docsById = new Map<string, DocEntry>();
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
      case 'd': {
        const doc: DocEntry = {
          id: rec.id as string,
          title: rec.t as string,
          text: rec.x as string,
        };
        if (typeof rec.u === 'string') doc.url = rec.u;
        if (rec.m && typeof rec.m === 'object') doc.meta = rec.m as Record<string, string>;
        this.docs.push(doc);
        this.docsById.set(doc.id, doc);
        break;
      }
      case 'c': {
        const docId = rec.d as string;
        const parent = this.docsById.get(docId);
        const charStart = rec.cs as number;
        const charEnd = rec.ce as number;
        // Slicing the parent's text shares its backing store (V8 SlicedString),
        // so per-chunk text costs offsets, not a copy.
        const chunk: DocChunk = {
          id: rec.id as string,
          docId,
          title: parent ? parent.title : '',
          text: parent ? parent.text.slice(charStart, charEnd) : '',
          position: rec.p as number,
          charStart,
          charEnd,
        };
        if (parent?.url) chunk.url = parent.url;
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
      docs: this.docs,
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
