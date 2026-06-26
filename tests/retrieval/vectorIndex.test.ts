import { describe, it, expect } from 'vitest';
import { VectorIndex, cosineSimilarity, l2normalize } from '../../src/retrieval/vectorIndex.ts';

describe('l2normalize', () => {
  it('scales a vector to unit length', () => {
    const v = l2normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
  });
  it('leaves a zero vector as zeros', () => {
    expect(Array.from(l2normalize([0, 0]))).toEqual([0, 0]);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });
  it('is scale-invariant', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1, 6);
  });
});

describe('VectorIndex', () => {
  const index = new VectorIndex(2, [
    [1, 0],
    [0, 1],
    [-1, 0],
  ], ['east', 'north', 'west']);

  it('ranks by cosine similarity to the query', () => {
    const hits = index.search([1, 0], 3);
    expect(hits.map((h) => h.id)).toEqual(['east', 'north', 'west']);
    expect(hits[0].score).toBeCloseTo(1, 6);
    expect(hits[1].score).toBeCloseTo(0, 6);
    expect(hits[2].score).toBeCloseTo(-1, 6);
  });

  it('honors topN', () => {
    expect(index.search([1, 0], 1)).toHaveLength(1);
  });

  it('reports its size and dimensionality', () => {
    expect(index.size).toBe(3);
    expect(index.dim).toBe(2);
  });

  it('rejects vectors of the wrong dimensionality', () => {
    expect(() => new VectorIndex(2, [[1, 2, 3]], ['x'])).toThrow();
    expect(() => index.search([1, 2, 3])).toThrow();
  });

  it('requires ids and vectors to be the same length', () => {
    expect(() => new VectorIndex(2, [[1, 0]], ['a', 'b'])).toThrow();
  });
});
