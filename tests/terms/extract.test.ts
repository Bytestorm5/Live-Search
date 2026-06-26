import { describe, it, expect } from 'vitest';
import { extractCandidateTerms } from '../../src/terms/extract.ts';

describe('extractCandidateTerms', () => {
  it('captures identifiers, capitalized words, and acronyms', () => {
    const terms = extractCandidateTerms('We use the AudioWorklet and getUserMedia for the API', {
      includeBigrams: false,
    });
    expect(terms).toContain('AudioWorklet');
    expect(terms).toContain('getUserMedia');
    expect(terms).toContain('API');
  });

  it('drops stopwords and very short tokens', () => {
    const terms = extractCandidateTerms('we use the of a it', { includeBigrams: false });
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('of');
    expect(terms).not.toContain('we');
    expect(terms).toContain('use');
  });

  it('emits adjacent content-word bigrams when enabled', () => {
    const terms = extractCandidateTerms('the audio worklet node', { includeBigrams: true });
    expect(terms).toContain('audio worklet');
    expect(terms).toContain('worklet node');
  });

  it('does not duplicate repeated terms', () => {
    const terms = extractCandidateTerms('WebGPU WebGPU WebGPU', { includeBigrams: false });
    expect(terms.filter((t) => t.toLowerCase() === 'webgpu')).toHaveLength(1);
  });

  it('keeps dotted identifiers like navigator.gpu intact', () => {
    const terms = extractCandidateTerms('check navigator.gpu first', { includeBigrams: false });
    expect(terms).toContain('navigator.gpu');
  });

  it('returns an empty array for empty input', () => {
    expect(extractCandidateTerms('')).toEqual([]);
  });
});
