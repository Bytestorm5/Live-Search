import { describe, it, expect } from 'vitest';
import { VadSegmenter } from '../../src/vad/segmenter.ts';
import type { SegmenterOptions } from '../../src/vad/segmenter.ts';

// Clean test units: 10 samples/frame @ 1 kHz => each frame is exactly 10 ms.
const BASE: SegmenterOptions = {
  sampleRate: 1000,
  frameSamples: 10,
  speechThreshold: 0.5,
  silenceThreshold: 0.35,
  endOfUtteranceSilenceMs: 40, // 4 frames
  minUtteranceMs: 20, // 2 frames
  maxUtteranceMs: 1000, // 100 frames (large; the max-length test overrides this)
  preSpeechPaddingMs: 20, // 2 frames
};

/** Build a frame of `frameSamples` filled with `value`. */
function frame(value: number, n = BASE.frameSamples): Float32Array {
  return new Float32Array(n).fill(value);
}

/** Feed `count` frames of a given probability/value, collecting any segments. */
function feed(seg: VadSegmenter, prob: number, count: number, value = prob >= 0.5 ? 1 : 0) {
  const segments = [];
  for (let i = 0; i < count; i++) {
    const s = seg.accept(prob, frame(value));
    if (s) segments.push(s);
  }
  return segments;
}

describe('VadSegmenter', () => {
  it('emits nothing during continuous silence', () => {
    const seg = new VadSegmenter(BASE);
    const segments = feed(seg, 0.0, 50);
    expect(segments).toHaveLength(0);
    expect(seg.state).toBe('idle');
  });

  it('emits one committed segment for a speech burst ended by silence', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.0, 5); // build pre-speech padding
    feed(seg, 0.9, 5); // 5 speech frames
    const out = feed(seg, 0.0, 4); // 4 silence frames -> end of utterance
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.reason).toBe('silence');
    expect(s.isFinal).toBe(true);
    // padding(20) + speech(50) + trailing silence(40) = 110 samples
    expect(s.audio.length).toBe(110);
    expect(s.startSample).toBe(30);
    expect(s.endSample).toBe(140);
    // Content: 20 zeros (padding), 50 ones (speech), 40 zeros (trailing).
    expect(s.audio[0]).toBe(0);
    expect(s.audio[19]).toBe(0);
    expect(s.audio[20]).toBe(1);
    expect(s.audio[69]).toBe(1);
    expect(s.audio[70]).toBe(0);
    expect(seg.state).toBe('idle');
  });

  it('rejects a too-short blip (cough/click) below the minimum length', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.0, 3);
    feed(seg, 0.9, 1); // only 1 speech frame (10 ms < 20 ms minimum)
    const out = feed(seg, 0.0, 4);
    expect(out).toHaveLength(0);
    expect(seg.state).toBe('idle');
  });

  it('uses hysteresis: a dip below the speech threshold but above silence keeps the utterance open', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.9, 3);
    // Dip to 0.4: below speechThreshold (0.5) but above silenceThreshold (0.35).
    // Must NOT count as silence, so no premature cut.
    const dip = feed(seg, 0.4, 3);
    expect(dip).toHaveLength(0);
    expect(seg.state).toBe('speaking');
    // Now real silence ends it.
    const out = feed(seg, 0.0, 4);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('silence');
  });

  it('forces an incremental cut on a long monologue, then keeps flowing', () => {
    const seg = new VadSegmenter({ ...BASE, preSpeechPaddingMs: 0, maxUtteranceMs: 100 });
    const cuts = feed(seg, 0.9, 12); // 12 speech frames; max is 10 frames (100 ms)
    expect(cuts).toHaveLength(1);
    expect(cuts[0].reason).toBe('maxLength');
    expect(cuts[0].isFinal).toBe(false);
    expect(cuts[0].audio.length).toBe(100);
    expect(seg.state).toBe('speaking'); // still mid-utterance
    // A trailing silence now commits the remainder.
    const out = feed(seg, 0.0, 4);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('silence');
  });

  it('flush() commits an in-progress utterance and resets to idle', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.9, 4); // speaking, no trailing silence yet
    const s = seg.flush();
    expect(s).not.toBeNull();
    expect(s!.reason).toBe('flush');
    expect(seg.state).toBe('idle');
    // A second flush with nothing pending returns null.
    expect(seg.flush()).toBeNull();
  });

  it('flush() returns null when the pending speech is below the minimum', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.9, 1); // 10 ms < 20 ms minimum
    expect(seg.flush()).toBeNull();
  });

  it('reset() clears all state', () => {
    const seg = new VadSegmenter(BASE);
    feed(seg, 0.9, 5);
    seg.reset();
    expect(seg.state).toBe('idle');
    // After reset, sample positions restart from 0.
    feed(seg, 0.0, 2);
    feed(seg, 0.9, 3);
    const out = feed(seg, 0.0, 4);
    expect(out[0].startSample).toBe(0); // padding clamped to available (2 frames -> 20), onset at 20 -> start 0
  });

  it('reports speaking state during an utterance', () => {
    const seg = new VadSegmenter(BASE);
    expect(seg.state).toBe('idle');
    feed(seg, 0.9, 2);
    expect(seg.state).toBe('speaking');
  });
});
