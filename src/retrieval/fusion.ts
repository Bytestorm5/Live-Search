/**
 * Reciprocal Rank Fusion (architecture spec §5.5 "Fusion").
 *
 * Merges the lexical and semantic result lists into a single ranking. RRF only
 * uses each item's *rank* within a list, not its raw score, which makes it
 * robust to the very different score scales of BM25 vs. cosine similarity —
 * exactly the situation here.
 *
 *   score(item) = Σ_lists weight_list * 1 / (k + rank_in_list)   (rank is 1-based)
 */

export interface Ranked {
  id: string;
}

export interface RrfOptions {
  /** Dampening constant; larger k flattens the contribution of top ranks. */
  k: number;
  /** Optional per-list multipliers (defaults to 1 for every list). */
  weights?: number[];
}

export interface FusedHit {
  id: string;
  score: number;
}

export function reciprocalRankFusion(lists: Ranked[][], opts: RrfOptions): FusedHit[] {
  const { k, weights } = opts;
  const scores = new Map<string, number>();

  lists.forEach((list, listIndex) => {
    const weight = weights?.[listIndex] ?? 1;
    list.forEach((item, i) => {
      const rank = i + 1; // 1-based
      const contribution = weight * (1 / (k + rank));
      scores.set(item.id, (scores.get(item.id) ?? 0) + contribution);
    });
  });

  const fused: FusedHit[] = [];
  for (const [id, score] of scores) fused.push({ id, score });
  fused.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return fused;
}
