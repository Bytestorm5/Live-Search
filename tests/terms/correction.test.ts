import { describe, it, expect } from 'vitest';
import { VocabularyCorrector } from '../../src/terms/correction.ts';
import { buildVocabulary } from '../../src/terms/vocabulary.ts';
import { DEFAULT_CONFIG } from '../../src/config.ts';

const VOCAB = buildVocabulary([
  'AudioWorklet', 'getUserMedia', 'WebGPU', 'Silero', 'Moonshine', 'BM25', 'MiniLM', 'transcribe',
]);
const cfg = DEFAULT_CONFIG.correction;

describe('buildVocabulary', () => {
  it('normalizes, counts frequency, and keys phonetically', () => {
    const v = buildVocabulary(['WebGPU', 'webgpu', 'Moonshine']);
    const webgpu = v.entries.find((e) => e.normalized === 'webgpu');
    expect(webgpu?.frequency).toBe(2);
    expect(webgpu?.phonetic).not.toBe('');
  });
});

describe('VocabularyCorrector', () => {
  const corrector = new VocabularyCorrector(VOCAB, cfg);

  it('maps a case-variant to the canonical surface form', () => {
    const c = corrector.correct('webgpu');
    expect(c.term).toBe('WebGPU');
    expect(c.source).toBe('exact');
  });

  it('leaves an exact canonical term unchanged', () => {
    const c = corrector.correct('Moonshine');
    expect(c.term).toBe('Moonshine');
    expect(c.corrected).toBe(false);
  });

  it('repairs a mistranscribed term by edit distance', () => {
    expect(corrector.correct('moonshyne').term).toBe('Moonshine');
    expect(corrector.correct('getusermeda').term).toBe('getUserMedia');
  });

  it('maps a spoken multi-word form to a joined identifier', () => {
    expect(corrector.correct('audio worklet').term).toBe('AudioWorklet');
  });

  it('uses phonetics to accept a low edit-similarity match', () => {
    // "beem25" ~ "BM25": same phonetic key, distance 2, similarity < threshold.
    expect(corrector.correct('beem25').term).toBe('BM25');
  });

  it('does NOT invent matches for out-of-corpus words (constrained correction)', () => {
    const c = corrector.correct('banana');
    expect(c.term).toBe('banana');
    expect(c.corrected).toBe(false);
    expect(c.source).toBe('none');
  });

  it('skips terms shorter than the minimum length', () => {
    expect(corrector.correct('ab').corrected).toBe(false);
  });

  it('correctTerms repairs in place and leaves unknowns alone', () => {
    expect(corrector.correctTerms(['the', 'moonshyne', 'qwerty'])).toEqual([
      'the',
      'Moonshine',
      'qwerty',
    ]);
  });
});
