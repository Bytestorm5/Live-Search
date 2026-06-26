import { describe, it, expect } from 'vitest';
import { Resampler } from '../../src/audio/resampler.ts';

/** Concatenate a list of Float32Arrays into one. */
function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('Resampler', () => {
  it('rejects non-positive rates', () => {
    expect(() => new Resampler(0, 16000)).toThrow();
    expect(() => new Resampler(48000, 0)).toThrow();
  });

  it('returns empty for empty input', () => {
    const r = new Resampler(48000, 16000);
    expect(r.process(new Float32Array(0)).length).toBe(0);
  });

  it('decimates an integer ratio (48k->16k) by taking every 3rd sample', () => {
    const r = new Resampler(48000, 16000);
    const ramp = new Float32Array(30);
    for (let i = 0; i < ramp.length; i++) ramp[i] = i;
    const out = r.process(ramp);
    // Linear interpolation of a linear ramp is exact, so outputs land on 0,3,6,...
    for (let k = 0; k < out.length; k++) {
      expect(out[k]).toBeCloseTo(k * 3, 5);
    }
  });

  it('produces approximately the right number of samples for a non-integer ratio', () => {
    const r = new Resampler(44100, 16000);
    const n = 44100; // one second
    const ramp = new Float32Array(n);
    for (let i = 0; i < n; i++) ramp[i] = i;
    const out = r.process(ramp);
    expect(out.length).toBeGreaterThan(15900);
    expect(out.length).toBeLessThan(16001);
  });

  it('interpolates a linear ramp exactly across block boundaries', () => {
    // Feeding the stream in small chunks must equal feeding it whole, because a
    // continuous resampler carries phase + the last sample across calls.
    const inputRate = 44100;
    const outputRate = 16000;
    const n = 4096;
    const ramp = new Float32Array(n);
    for (let i = 0; i < n; i++) ramp[i] = i * 0.001;

    const whole = new Resampler(inputRate, outputRate).process(ramp);

    const streaming = new Resampler(inputRate, outputRate);
    const chunks: Float32Array[] = [];
    for (let off = 0; off < n; off += 128) {
      chunks.push(streaming.process(ramp.subarray(off, Math.min(off + 128, n))));
    }
    const streamed = concat(chunks);

    // Same count (±1 from boundary rounding) and same values.
    expect(Math.abs(streamed.length - whole.length)).toBeLessThanOrEqual(1);
    const common = Math.min(streamed.length, whole.length);
    for (let k = 0; k < common; k++) {
      expect(streamed[k]).toBeCloseTo(whole[k], 6);
    }
  });

  it('reset() clears carried phase', () => {
    const r = new Resampler(48000, 16000);
    r.process(Float32Array.from([1, 2, 3, 4, 5]));
    r.reset();
    const out = r.process(Float32Array.from([10, 20, 30]));
    expect(out[0]).toBeCloseTo(10, 5); // first output again aligns to input[0]
  });
});
