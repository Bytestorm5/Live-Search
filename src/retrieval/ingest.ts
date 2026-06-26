/**
 * Build the on-device documentation index (architecture spec §5.4, §5.5).
 *
 * This is pure and synchronous: it chunks the corpus, builds the BM25 lexical
 * index, and extracts the known vocabulary for correction. Embeddings are
 * optional and attached separately (they require the embedding model), so the
 * index can be built offline at `npm run ingest` time and embedded either then
 * or in-browser at load.
 */
import type { AppConfig } from '../config.ts';
import { Bm25Index } from './bm25.ts';
import { chunkCorpus } from './chunk.ts';
import { STOPWORDS, tokenize } from './tokenize.ts';
import type { CorpusIndex, EmbeddingsData, RawDoc } from './types.ts';
import { buildVocabulary } from '../terms/vocabulary.ts';
import { extractCandidateTerms } from '../terms/extract.ts';

export const INDEX_VERSION = 1;

/** Collect domain terms across the corpus for vocabulary-constrained correction. */
function collectVocabularyTerms(docs: RawDoc[]): string[] {
  const terms: string[] = [];
  for (const doc of docs) {
    // Title words are strong domain signals; weight them by including the title.
    for (const t of extractCandidateTerms(`${doc.title}\n${doc.text}`, {
      includeBigrams: false,
      minLength: 4,
    })) {
      // Drop sentence-initial capitalized stopwords (e.g. "The") that the
      // extractor flags as salient — they would only cause noisy corrections.
      if (STOPWORDS.has(t.toLowerCase())) continue;
      terms.push(t);
    }
  }
  return terms;
}

export interface BuildIndexResult {
  index: CorpusIndex;
}

/** Build a {@link CorpusIndex} (without embeddings). */
export function buildIndex(docs: RawDoc[], config: AppConfig): CorpusIndex {
  const chunks = chunkCorpus(docs, {
    chunkSizeTokens: config.retrieval.chunkSizeTokens,
    chunkOverlapTokens: config.retrieval.chunkOverlapTokens,
  });

  const bm25 = Bm25Index.build(
    chunks.map((c) => ({ id: c.id, tokens: tokenize(c.text) })),
    { k1: config.retrieval.bm25K1, b: config.retrieval.bm25B },
  );

  const vocabulary = buildVocabulary(collectVocabularyTerms(docs));

  return {
    version: INDEX_VERSION,
    chunks,
    bm25: bm25.data,
    vocabulary,
  };
}

/** Attach precomputed embeddings to an index (immutably). */
export function withEmbeddings(index: CorpusIndex, embeddings: EmbeddingsData): CorpusIndex {
  if (embeddings.vectors.length !== index.chunks.length) {
    throw new Error(
      `withEmbeddings: ${embeddings.vectors.length} vectors for ${index.chunks.length} chunks`,
    );
  }
  return { ...index, embeddings };
}
