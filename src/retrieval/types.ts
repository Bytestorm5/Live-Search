/**
 * Corpus, index, and search result types (architecture spec §5.4, §5.5).
 *
 * The documentation corpus is loaded entirely on-device; no query ever leaves
 * the browser (spec §5.5 "Corpus loading", §7).
 */

/** A documentation file as provided by the operator before chunking. */
export interface RawDoc {
  /** Stable unique id (e.g. file path or slug). */
  id: string;
  title: string;
  /** Plain-text body (markdown/html already stripped to text). */
  text: string;
  /** Optional source link or anchor, surfaced in the results panel. */
  url?: string;
  /** Optional free-form metadata (section, tags, ...). */
  meta?: Record<string, string>;
  /**
   * Proper-noun / domain terms (e.g. frontmatter name + traits) that should be
   * weighted heavily in retrieval (spec §5.4). Applied to every chunk of the doc.
   */
  boostTerms?: string[];
}

/**
 * A retrievable unit of documentation. Long docs are split into overlapping
 * chunks so semantic matches are localized (spec §5.5 "Documentation is
 * chunked and embedded").
 */
export interface DocChunk {
  /** Unique chunk id, derived from docId + position. */
  id: string;
  docId: string;
  title: string;
  text: string;
  url?: string;
  /** 0-based index of this chunk within its parent document. */
  position: number;
}

/** Serialized BM25 inverted index (spec §5.5 "Lexical"). */
export interface Bm25IndexData {
  /** BM25 term-frequency saturation parameter. */
  k1: number;
  /** BM25 length-normalization parameter. */
  b: number;
  /** Number of documents (chunks) indexed. */
  docCount: number;
  /** Average document length in tokens. */
  avgDocLength: number;
  /** chunkId -> token length of that chunk. */
  docLengths: Record<string, number>;
  /** term -> postings list of { chunkId, termFrequency }. */
  postings: Record<string, Array<{ id: string; tf: number }>>;
}

/**
 * The known vocabulary used for vocabulary-constrained correction (spec §5.4):
 * product names, API symbols, acronyms and other domain terms extracted at
 * index-build time.
 */
export interface VocabularyEntry {
  /** Canonical surface form as it appears in the docs (e.g. "getUserMedia"). */
  term: string;
  /** Lowercased form used for exact-match short-circuiting. */
  normalized: string;
  /** Phonetic key (double-metaphone-ish) for sound-alike matching. */
  phonetic: string;
  /** How many times the term occurs across the corpus (popularity prior). */
  frequency: number;
}

export interface VocabularyData {
  entries: VocabularyEntry[];
}

/** Optional precomputed chunk embeddings, aligned 1:1 with {@link CorpusIndex.chunks}. */
export interface EmbeddingsData {
  /** Embedding dimensionality. */
  dim: number;
  /** L2-normalized vectors, one per chunk, in chunk order. */
  vectors: number[][];
  /** Model that produced the vectors (must match the query-time embedder). */
  modelId: string;
}

/** The complete on-device index produced by `npm run ingest` (or built at load). */
export interface CorpusIndex {
  version: number;
  /** ISO timestamp; informational only. */
  builtAt?: string;
  chunks: DocChunk[];
  bm25: Bm25IndexData;
  vocabulary: VocabularyData;
  /** Present when embeddings were precomputed at build time. */
  embeddings?: EmbeddingsData;
}

/** A single ranked search result returned to the UI. */
export interface SearchHit {
  chunk: DocChunk;
  /** Fused relevance score (higher is better). */
  score: number;
  /** Contribution from the lexical (BM25) retriever, if any. */
  lexicalScore?: number;
  /** Contribution from the semantic (vector) retriever, if any. */
  semanticScore?: number;
  /** Best matching excerpt with the query terms highlighted by «». */
  snippet: string;
  /** Query terms that matched this chunk lexically. */
  matchedTerms: string[];
}

/** A parsed query as it enters the retrieval engine. */
export interface RetrievalQuery {
  /** Corrected candidate terms (spec §5.4) that drive lexical search. */
  terms: string[];
  /** Rolling transcript window used for the semantic query (spec §5.5, §6). */
  transcriptWindow: string;
  /** Number of results to return. */
  k: number;
  /** Chunk ids already on screen, de-duplicated out of results (spec §4 step 5). */
  excludeChunkIds?: string[];
}
