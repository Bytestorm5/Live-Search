import { describe, it, expect } from 'vitest';
import { rms, toMeterLevel } from '../../src/audio/level.ts';

describe('rms', () => {
  it('is zero for silence and empty frames', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(Float32Array.from([0, 0, 0, 0]))).toBe(0);
  });
  it('is the amplitude for a full-scale square wave', () => {
    expect(rms(Float32Array.from([1, -1, 1, -1]))).toBeCloseTo(1, 6);
    expect(rms(Float32Array.from([0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });
});

describe('toMeterLevel', () => {
  it('applies gain and clamps to 1', () => {
    expect(toMeterLevel(0, 4)).toBe(0);
    expect(toMeterLevel(0.1, 4)).toBeCloseTo(0.4, 6);
    expect(toMeterLevel(0.25, 4)).toBe(1);
    expect(toMeterLevel(0.9, 4)).toBe(1);
  });
});
