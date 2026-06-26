/**
 * In-browser BM25 lexical index (architecture spec §5.5 "Lexical").
 *
 * BM25 is fast, interpretable, and excellent for exact entity/term hits — e.g. a
 * specific API name — which is exactly what the corrected domain terms from
 * §5.4 produce. The index serializes to {@link Bm25IndexData} so it can be built
 * at ingest time (Node) and shipped, or rebuilt in-browser at load.
 */
import type { Bm25IndexData } from './types.ts';

export interface Bm25Hit {
  id: string;
  score: number;
  /** Query terms that occurred in this document. */
  matched: string[];
}

export interface Bm25Options {
  k1: number;
  b: number;
}

interface DocTokens {
  id: string;
  tokens: string[];
}

export class Bm25Index {
  readonly data: Bm25IndexData;

  constructor(data: Bm25IndexData) {
    this.data = data;
  }

  /** Number of indexed documents (chunks). */
  get docCount(): number {
    return this.data.docCount;
  }

  /** Document frequency of a term (how many chunks contain it). */
  docFrequency(term: string): number {
    return this.data.postings[term]?.length ?? 0;
  }

  /** Fraction of chunks containing the term, in [0, 1] (a rarity signal). */
  documentRatio(term: string): number {
    if (this.data.docCount === 0) return 0;
    return this.docFrequency(term) / this.data.docCount;
  }

  /** Build an index from tokenized documents. */
  static build(docs: DocTokens[], opts: Bm25Options): Bm25Index {
    const postings: Bm25IndexData['postings'] = Object.create(null);
    const docLengths: Bm25IndexData['docLengths'] = Object.create(null);
    let totalLength = 0;

    for (const { id, tokens } of docs) {
      docLengths[id] = tokens.length;
      totalLength += tokens.length;

      // Term frequencies within this document.
      const tf = new Map<string, number>();
      for (const term of tokens) tf.set(term, (tf.get(term) ?? 0) + 1);
      for (const [term, freq] of tf) {
        (postings[term] ??= []).push({ id, tf: freq });
      }
    }

    const docCount = docs.length;
    return new Bm25Index({
      k1: opts.k1,
      b: opts.b,
      docCount,
      avgDocLength: docCount > 0 ? totalLength / docCount : 0,
      docLengths,
      postings,
    });
  }

  /** Inverse document frequency for a term (BM25 "plus 0.5" form). */
  private idf(term: string): number {
    const postings = this.data.postings[term];
    const df = postings ? postings.length : 0;
    if (df === 0) return 0;
    return Math.log(1 + (this.data.docCount - df + 0.5) / (df + 0.5));
  }

  /**
   * Score `queryTokens` against the corpus and return the top results, highest
   * first. Duplicate query tokens are collapsed (a term contributes once).
   */
  search(queryTokens: string[], topN = 20): Bm25Hit[] {
    const { k1, b, avgDocLength, docLengths } = this.data;
    const scores = new Map<string, number>();
    const matched = new Map<string, Set<string>>();
    const uniqueTerms = [...new Set(queryTokens)];

    for (const term of uniqueTerms) {
      const postings = this.data.postings[term];
      if (!postings) continue;
      const idf = this.idf(term);
      for (const { id, tf } of postings) {
        const dl = docLengths[id] ?? 0;
        const denom = tf + k1 * (1 - b + (b * dl) / (avgDocLength || 1));
        const contribution = idf * ((tf * (k1 + 1)) / (denom || 1));
        scores.set(id, (scores.get(id) ?? 0) + contribution);
        (matched.get(id) ?? matched.set(id, new Set()).get(id)!).add(term);
      }
    }

    const hits: Bm25Hit[] = [];
    for (const [id, score] of scores) {
      // Preserve query order in `matched` for stable, readable output.
      const hitTerms = uniqueTerms.filter((t) => matched.get(id)?.has(t));
      hits.push({ id, score, matched: hitTerms });
    }
    hits.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    return hits.slice(0, topN);
  }
}
