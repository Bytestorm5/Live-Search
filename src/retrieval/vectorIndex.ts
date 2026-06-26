/**
 * Semantic (vector) retrieval (architecture spec §5.5 "Semantic").
 *
 * Documentation chunks are embedded with a small local model; at query time the
 * corrected terms + rolling transcript window are embedded and compared by
 * cosine similarity. This catches topic matches even when the exact term wasn't
 * spoken. The corpus is small (a few thousand chunks, spec §6), so an exact
 * brute-force cosine scan is well within the latency budget and avoids the
 * complexity of an approximate index.
 */

export type Vector = number[] | Float32Array;

/** L2-normalize a vector. A zero vector is returned unchanged (all zeros). */
export function l2normalize(v: Vector): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/** Cosine similarity in [-1, 1]; returns 0 if either vector is all zeros. */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface VectorHit {
  id: string;
  score: number;
}

export class VectorIndex {
  readonly dim: number;
  private readonly ids: string[];
  /** Pre-normalized vectors, so query scoring is a single dot product. */
  private readonly vectors: Float32Array[];

  constructor(dim: number, vectors: Vector[], ids: string[]) {
    if (vectors.length !== ids.length) {
      throw new Error(`VectorIndex: got ${vectors.length} vectors but ${ids.length} ids`);
    }
    this.dim = dim;
    this.ids = ids;
    this.vectors = vectors.map((v, i) => {
      if (v.length !== dim) {
        throw new Error(`VectorIndex: vector ${i} has dimension ${v.length}, expected ${dim}`);
      }
      return l2normalize(v);
    });
  }

  get size(): number {
    return this.ids.length;
  }

  /** Return the top-N chunks by cosine similarity to `query`. */
  search(query: Vector, topN = 20): VectorHit[] {
    if (query.length !== this.dim) {
      throw new Error(`VectorIndex.search: query dimension ${query.length}, expected ${this.dim}`);
    }
    const q = l2normalize(query);
    const hits: VectorHit[] = new Array(this.ids.length);
    for (let i = 0; i < this.vectors.length; i++) {
      const v = this.vectors[i];
      let dot = 0;
      for (let d = 0; d < this.dim; d++) dot += v[d] * q[d];
      hits[i] = { id: this.ids[i], score: dot };
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return hits.slice(0, topN);
  }
}
