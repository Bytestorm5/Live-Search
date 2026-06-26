/**
 * Documentation chunking (architecture spec §5.5: "Documentation is chunked and
 * embedded"). Long docs are split into overlapping windows so semantic matches
 * are localized and snippets are tight. Chunks preserve the original text
 * verbatim (including formatting) by slicing the source string between word
 * boundaries.
 */
import type { DocChunk, RawDoc } from './types.ts';

export interface ChunkOptions {
  /** Target chunk size in whitespace-delimited tokens. */
  chunkSizeTokens: number;
  /** Number of tokens shared between adjacent chunks. */
  chunkOverlapTokens: number;
}

interface Span {
  start: number;
  end: number;
}

/** Locate whitespace-delimited token spans in `text`. */
function tokenSpans(text: string): Span[] {
  const spans: Span[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/** Split one document into overlapping chunks. */
export function chunkDocument(doc: RawDoc, opts: ChunkOptions): DocChunk[] {
  const size = Math.max(1, Math.floor(opts.chunkSizeTokens));
  const overlap = Math.min(Math.max(0, Math.floor(opts.chunkOverlapTokens)), size - 1);
  const step = Math.max(1, size - overlap);

  const spans = tokenSpans(doc.text);
  if (spans.length === 0) return [];

  const chunks: DocChunk[] = [];
  let position = 0;
  for (let i = 0; i < spans.length; i += step) {
    const end = Math.min(i + size, spans.length);
    const text = doc.text.slice(spans[i].start, spans[end - 1].end);
    chunks.push({
      id: `${doc.id}#${position}`,
      docId: doc.id,
      title: doc.title,
      text,
      ...(doc.url ? { url: doc.url } : {}),
      position,
    });
    position++;
    if (end === spans.length) break;
  }
  return chunks;
}

/** Chunk a whole corpus. */
export function chunkCorpus(docs: RawDoc[], opts: ChunkOptions): DocChunk[] {
  const out: DocChunk[] = [];
  for (const doc of docs) out.push(...chunkDocument(doc, opts));
  return out;
}
