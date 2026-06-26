import { describe, it, expect } from 'vitest';
import { levenshtein, damerauLevenshtein, similarity } from '../../src/terms/editDistance.ts';

describe('levenshtein', () => {
  it('computes the classic example', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
  it('handles empty strings and equality', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
  it('counts a transposition as two edits', () => {
    expect(levenshtein('ab', 'ba')).toBe(2);
  });
});

describe('damerauLevenshtein', () => {
  it('counts an adjacent transposition as one edit', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('moonhsine', 'moonshine')).toBe(1); // adjacent s/h swap
  });
  it('agrees with Levenshtein when there are no transpositions', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('similarity', () => {
  it('is 1 for identical and 0 for fully different equal-length strings', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });
  it('scales with the longer length', () => {
    expect(similarity('moonshine', 'moonshyne')).toBeCloseTo(1 - 1 / 9, 6);
  });
  it('treats two empty strings as identical', () => {
    expect(similarity('', '')).toBe(1);
  });
});
