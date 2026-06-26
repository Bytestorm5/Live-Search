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
import { isCommonWord } from '../terms/commonWords.ts';

export const INDEX_VERSION = 1;

/** Each proper-noun boost token is added this many times to a chunk's BM25 tokens. */
const BOOST_REPEAT = 3;
/** A term in more than this fraction of chunks is too common (in this corpus) to be salient. */
const VOCAB_COMMON_FRACTION = 0.5;

/**
 * Collect domain terms for vocabulary-constrained correction (spec §5.4),
 * weighting proper nouns and dropping words that are too common to be salient.
 */
function collectVocabularyTerms(docs: RawDoc[], bm25: Bm25Index): string[] {
  const terms: string[] = [];
  const isCommon = (lower: string) => isCommonWord(lower) || bm25.documentRatio(lower) > VOCAB_COMMON_FRACTION;

  for (const doc of docs) {
    // Frontmatter proper nouns (name, traits, ...) are always strong vocab terms.
    for (const boost of doc.boostTerms ?? []) {
      terms.push(boost);
      for (const tok of tokenize(boost)) terms.push(tok);
    }
    // Other candidate terms, with common words (e.g. "Wonderful") filtered out.
    for (const t of extractCandidateTerms(`${doc.title}\n${doc.text}`, {
      includeBigrams: false,
      minLength: 4,
      isCommon,
    })) {
      const lower = t.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (isCommon(lower)) continue; // over-common words make noisy correction targets
      terms.push(t);
    }
  }
  return terms;
}

/** Build a {@link CorpusIndex} (without embeddings). */
export function buildIndex(docs: RawDoc[], config: AppConfig): CorpusIndex {
  const chunks = chunkCorpus(docs, {
    chunkSizeTokens: config.retrieval.chunkSizeTokens,
    chunkOverlapTokens: config.retrieval.chunkOverlapTokens,
  });

  // Proper-noun boost terms apply to every chunk of their document.
  const boostByDoc = new Map<string, string[]>();
  for (const doc of docs) if (doc.boostTerms?.length) boostByDoc.set(doc.id, doc.boostTerms);

  const bm25 = Bm25Index.build(
    chunks.map((c) => {
      let tokens = tokenize(c.text);
      const boosts = boostByDoc.get(c.docId);
      if (boosts && boosts.length) {
        const boostTokens = tokenize(boosts.join(' '));
        for (let r = 0; r < BOOST_REPEAT; r++) tokens = tokens.concat(boostTokens);
      }
      return { id: c.id, tokens };
    }),
    { k1: config.retrieval.bm25K1, b: config.retrieval.bm25B },
  );

  const vocabulary = buildVocabulary(collectVocabularyTerms(docs, bm25));

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
