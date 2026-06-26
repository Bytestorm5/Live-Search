/**
 * Hybrid retrieval engine (architecture spec §5.5).
 *
 * Combines a lexical BM25 retriever (precision on exact domain terms) with a
 * semantic vector retriever (recall on paraphrased topics) and fuses them with
 * Reciprocal Rank Fusion. It also owns the vocabulary corrector (§5.4), since
 * the known vocabulary ships inside the index. Everything runs in-browser; no
 * query leaves the device (§5.5, §7).
 */
import type { AppConfig } from '../config.ts';
import { VocabularyCorrector } from '../terms/correction.ts';
import { Bm25Index } from './bm25.ts';
import type { EmbeddingModel } from './embedding.ts';
import { embedChunks } from './embedding.ts';
import { reciprocalRankFusion } from './fusion.ts';
import { makeSnippet } from './snippet.ts';
import { tokenize } from './tokenize.ts';
import { extractCandidateTerms } from '../terms/extract.ts';
import { isCommonWord } from '../terms/commonWords.ts';
import type { CorpusIndex, DocChunk, RetrievalQuery, SearchHit } from './types.ts';
import { VectorIndex } from './vectorIndex.ts';

/** A query term in more than this fraction of chunks isn't treated as salient. */
const QUERY_COMMON_FRACTION = 0.3;

export interface RetrievalEngineOptions {
  index: CorpusIndex;
  config: AppConfig;
  /** Required for semantic retrieval; omit for a lexical-only engine. */
  embedder?: EmbeddingModel;
}

export class RetrievalEngine {
  private readonly index: CorpusIndex;
  private readonly config: AppConfig;
  private readonly embedder?: EmbeddingModel;
  private readonly chunksById = new Map<string, DocChunk>();
  private readonly bm25: Bm25Index;
  private readonly corrector: VocabularyCorrector;
  private vectorIndex: VectorIndex | null = null;
  private initialized = false;

  constructor(opts: RetrievalEngineOptions) {
    this.index = opts.index;
    this.config = opts.config;
    if (opts.embedder) this.embedder = opts.embedder;
    for (const c of opts.index.chunks) this.chunksById.set(c.id, c);
    this.bm25 = new Bm25Index(opts.index.bm25);
    this.corrector = new VocabularyCorrector(opts.index.vocabulary, opts.config.correction);

    // If embeddings were precomputed at ingest time, the semantic index is ready
    // immediately (no model needed just to search).
    if (opts.index.embeddings) {
      this.buildVectorIndexFromEmbeddings();
    }
  }

  /**
   * Prepare the semantic index. If embeddings weren't precomputed, embed all
   * chunks now using the supplied embedder (in-browser at load — spec §5.5).
   * Safe to call repeatedly.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.vectorIndex && this.embedder) {
      if (this.embedder.load) await this.embedder.load();
      const embeddings = await embedChunks(this.index.chunks, this.embedder);
      this.vectorIndex = new VectorIndex(
        embeddings.dim,
        embeddings.vectors,
        this.index.chunks.map((c) => c.id),
      );
    }
    this.initialized = true;
  }

  get hasSemantic(): boolean {
    // Semantic search needs BOTH a vector index AND an embedder to embed the
    // query at runtime. Precomputed embeddings alone aren't enough.
    return this.vectorIndex !== null && this.embedder != null;
  }

  get chunkCount(): number {
    return this.index.chunks.length;
  }

  /** Apply vocabulary-constrained correction to candidate terms (spec §5.4). */
  correct(terms: string[]): string[] {
    return this.corrector.correctTerms(terms);
  }

  /**
   * Extract candidate query terms from a transcript, rarity-aware (common
   * capitalized words aren't treated as proper nouns, spec §5.4), then correct
   * them against the known vocabulary.
   */
  candidateTerms(text: string): { rawTerms: string[]; correctedTerms: string[] } {
    const isCommon = (lower: string) => isCommonWord(lower) || this.bm25.documentRatio(lower) > QUERY_COMMON_FRACTION;
    const rawTerms = extractCandidateTerms(text, { isCommon });
    return { rawTerms, correctedTerms: this.correct(rawTerms) };
  }

  /** Run a hybrid query and return the top-k de-duplicated hits. */
  async query(q: RetrievalQuery): Promise<SearchHit[]> {
    const k = q.k > 0 ? q.k : this.config.retrieval.topK;
    const exclude = new Set(q.excludeChunkIds ?? []);
    const poolSize = Math.max(k * 4, 20);

    // --- Lexical ---
    const queryTokens = tokenize(q.terms.join(' '));
    const lexicalHits = queryTokens.length > 0 ? this.bm25.search(queryTokens, poolSize) : [];
    const lexicalScore = new Map(lexicalHits.map((h) => [h.id, h.score]));
    const matchedById = new Map(lexicalHits.map((h) => [h.id, h.matched]));

    // --- Semantic ---
    let semanticHits: { id: string; score: number }[] = [];
    const semanticText = `${q.transcriptWindow} ${q.terms.join(' ')}`.trim();
    if (this.vectorIndex && this.embedder && semanticText.length > 0) {
      await this.init();
      const [vec] = await this.embedder.embed([semanticText]);
      semanticHits = this.vectorIndex.search(vec, poolSize);
    }
    const semanticScore = new Map(semanticHits.map((h) => [h.id, h.score]));

    // --- Fusion ---
    const fused = reciprocalRankFusion([lexicalHits, semanticHits], { k: this.config.retrieval.rrfK });

    const hits: SearchHit[] = [];
    for (const f of fused) {
      if (exclude.has(f.id)) continue;
      const chunk = this.chunksById.get(f.id);
      if (!chunk) continue;
      const matched = matchedById.get(f.id) ?? [];
      const hit: SearchHit = {
        chunk,
        score: f.score,
        snippet: makeSnippet(chunk.text, q.terms.length ? q.terms : matched),
        matchedTerms: matched,
      };
      if (lexicalScore.has(f.id)) hit.lexicalScore = lexicalScore.get(f.id);
      if (semanticScore.has(f.id)) hit.semanticScore = semanticScore.get(f.id);
      hits.push(hit);
      if (hits.length >= k) break;
    }
    return hits;
  }

  private buildVectorIndexFromEmbeddings(): void {
    const emb = this.index.embeddings!;
    if (emb.vectors.length !== this.index.chunks.length) {
      throw new Error('RetrievalEngine: embeddings length does not match chunk count');
    }
    this.vectorIndex = new VectorIndex(
      emb.dim,
      emb.vectors,
      this.index.chunks.map((c) => c.id),
    );
  }
}
