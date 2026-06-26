import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../../src/retrieval/fusion.ts';

describe('reciprocalRankFusion', () => {
  it('rewards items ranked highly across multiple lists', () => {
    const lexical = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const semantic = [{ id: 'b' }, { id: 'a' }, { id: 'd' }];
    const fused = reciprocalRankFusion([lexical, semantic], { k: 60 });
    // 'a' (ranks 1 & 2) and 'b' (ranks 2 & 1) appear in both -> top two.
    expect(fused.slice(0, 2).map((f) => f.id).sort()).toEqual(['a', 'b']);
    expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('computes RRF scores as the sum of 1/(k+rank)', () => {
    const list = [{ id: 'x' }, { id: 'y' }];
    const fused = reciprocalRankFusion([list], { k: 1 });
    // ranks are 1-based: x -> 1/(1+1)=0.5, y -> 1/(1+2)=0.333...
    expect(fused[0].id).toBe('x');
    expect(fused[0].score).toBeCloseTo(0.5, 6);
    expect(fused[1].score).toBeCloseTo(1 / 3, 6);
  });

  it('supports per-list weights', () => {
    const lexical = [{ id: 'a' }, { id: 'b' }];
    const semantic = [{ id: 'b' }, { id: 'a' }];
    // Heavily weight the semantic list, which prefers 'b'.
    const fused = reciprocalRankFusion([lexical, semantic], { k: 60, weights: [1, 10] });
    expect(fused[0].id).toBe('b');
  });

  it('includes items that appear in only one list', () => {
    const fused = reciprocalRankFusion([[{ id: 'only' }], []], { k: 60 });
    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe('only');
  });

  it('returns an empty list for empty input', () => {
    expect(reciprocalRankFusion([], { k: 60 })).toEqual([]);
    expect(reciprocalRankFusion([[], []], { k: 60 })).toEqual([]);
  });
});
