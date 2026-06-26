import { describe, it, expect } from 'vitest';
import { soundex, phoneticKey } from '../../src/terms/phonetic.ts';

describe('soundex', () => {
  it('matches canonical published codes', () => {
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
    expect(soundex('Rubin')).toBe('R150');
    expect(soundex('Jackson')).toBe('J250');
    expect(soundex('Washington')).toBe('W252');
    expect(soundex('Honeyman')).toBe('H555');
    expect(soundex('Pfister')).toBe('P236'); // first-letter collapse (P,f both '1')
  });
  it('returns empty for non-alphabetic input', () => {
    expect(soundex('')).toBe('');
    expect(soundex('123')).toBe('');
  });
});

describe('phoneticKey', () => {
  it('gives sound-alikes the same key', () => {
    expect(phoneticKey('Moonshine')).toBe(phoneticKey('moonshyne'));
    expect(phoneticKey('Silero')).toBe(phoneticKey('salero'));
  });
  it('keeps more detail than 4-char soundex on long terms', () => {
    expect(phoneticKey('Washington').length).toBeGreaterThan(4);
  });
  it('distinguishes clearly different words', () => {
    expect(phoneticKey('Moonshine')).not.toBe(phoneticKey('Whisper'));
  });
});
