import { describe, it, expect } from 'vitest';
import { RollingTranscript } from '../../src/pipeline/transcript.ts';

describe('RollingTranscript', () => {
  it('accumulates committed utterances', () => {
    const t = new RollingTranscript(100);
    t.append('hello world');
    t.append('how are you');
    expect(t.window).toBe('hello world how are you');
  });

  it('ignores empty/whitespace appends', () => {
    const t = new RollingTranscript(100);
    t.append('  ');
    t.append('');
    expect(t.window).toBe('');
  });

  it('evicts the oldest parts past the character cap', () => {
    const t = new RollingTranscript(12);
    t.append('aaaa'); // 4
    t.append('bbbb'); // 4
    t.append('cccc'); // 4 -> would exceed, drop oldest
    expect(t.window).not.toContain('aaaa');
    expect(t.window).toContain('cccc');
    expect(t.length).toBeLessThanOrEqual(12);
  });

  it('always keeps at least the most recent part even if it exceeds the cap', () => {
    const t = new RollingTranscript(5);
    t.append('this is a very long single utterance');
    expect(t.window).toBe('this is a very long single utterance');
  });

  it('clear() empties the window', () => {
    const t = new RollingTranscript(100);
    t.append('something');
    t.clear();
    expect(t.window).toBe('');
    expect(t.length).toBe(0);
  });
});
