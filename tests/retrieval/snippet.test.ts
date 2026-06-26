import { describe, it, expect } from 'vitest';
import { makeSnippet } from '../../src/retrieval/snippet.ts';

describe('makeSnippet', () => {
  it('highlights matched terms with guillemets', () => {
    const s = makeSnippet('The AudioWorklet runs on the audio thread.', ['AudioWorklet']);
    expect(s).toContain('«AudioWorklet»');
  });

  it('is case-insensitive when matching', () => {
    const s = makeSnippet('We call getUserMedia here.', ['getusermedia']);
    expect(s).toContain('«getUserMedia»');
  });

  it('centers a window around the first match and truncates with ellipses', () => {
    const long = 'x '.repeat(200) + 'NEEDLE ' + 'y '.repeat(200);
    const s = makeSnippet(long, ['NEEDLE'], { maxLength: 60 });
    expect(s).toContain('«NEEDLE»');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(60 + 8); // window + markers/ellipses
  });

  it('does not nest highlights for overlapping terms', () => {
    const s = makeSnippet('The AudioWorklet node.', ['audio', 'AudioWorklet']);
    expect(s).toContain('«AudioWorklet»');
    expect(s).not.toContain('««');
  });

  it('falls back to a head snippet when no term matches', () => {
    const s = makeSnippet('Nothing relevant here at all.', ['missing'], { maxLength: 100 });
    expect(s).toBe('Nothing relevant here at all.');
    expect(s).not.toContain('«');
  });

  it('returns plain text when no terms are given', () => {
    expect(makeSnippet('plain text', [])).toBe('plain text');
  });
});
