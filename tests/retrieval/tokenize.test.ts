import { describe, it, expect } from 'vitest';
import { tokenize, removeStopwords, splitIdentifier, STOPWORDS } from '../../src/retrieval/tokenize.ts';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric boundaries', () => {
    expect(tokenize('The Quick, brown FOX!')).toEqual(['the', 'quick', 'brown', 'fox']);
  });

  it('keeps alphanumeric identifiers intact', () => {
    expect(tokenize('getUserMedia and OAuth2 tokens')).toEqual(['getusermedia', 'and', 'oauth2', 'tokens']);
  });

  it('drops empty tokens and punctuation-only input', () => {
    expect(tokenize('   ...  ,  ')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('treats dotted/hyphenated symbols as separate tokens', () => {
    expect(tokenize('navigator.gpu whisper-base.en')).toEqual(['navigator', 'gpu', 'whisper', 'base', 'en']);
  });
});

describe('removeStopwords', () => {
  it('filters common English stopwords', () => {
    expect(removeStopwords(['the', 'quick', 'a', 'fox'])).toEqual(['quick', 'fox']);
  });
  it('STOPWORDS includes obvious function words', () => {
    expect(STOPWORDS.has('the')).toBe(true);
    expect(STOPWORDS.has('and')).toBe(true);
    expect(STOPWORDS.has('fox')).toBe(false);
  });
});

describe('splitIdentifier', () => {
  it('splits camelCase into lowercased parts', () => {
    expect(splitIdentifier('getUserMedia')).toEqual(['get', 'user', 'media']);
  });
  it('splits PascalCase and digit boundaries', () => {
    expect(splitIdentifier('OAuth2Client')).toEqual(['o', 'auth', '2', 'client']);
  });
  it('splits snake_case and kebab-case', () => {
    expect(splitIdentifier('audio_worklet-node')).toEqual(['audio', 'worklet', 'node']);
  });
  it('returns a single part for a plain word', () => {
    expect(splitIdentifier('fox')).toEqual(['fox']);
  });
});
