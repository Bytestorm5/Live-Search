import { describe, it, expect } from 'vitest';
import { floatTo16BitPCM, int16ToBase64, bytesToBase64, floatFrameToBase64 } from '../../src/asr/pcm.ts';

describe('floatTo16BitPCM', () => {
  it('maps the full range and clamps out-of-range values', () => {
    const out = floatTo16BitPCM(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768]);
  });
});

describe('int16ToBase64 / bytesToBase64', () => {
  it('encodes little-endian 16-bit samples to base64 that round-trips', () => {
    const pcm = Int16Array.from([0, 1, -1, 256]);
    const b64 = int16ToBase64(pcm);
    // Decode and verify little-endian byte layout.
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    expect(Array.from(bytes)).toEqual([
      0, 0, // 0
      1, 0, // 1
      255, 255, // -1
      0, 1, // 256
    ]);
  });

  it('handles large buffers without overflowing', () => {
    const big = new Uint8Array(100_000).fill(65);
    const b64 = bytesToBase64(big);
    expect(atob(b64).length).toBe(100_000);
  });

  it('floatFrameToBase64 composes conversion + encoding', () => {
    const b64 = floatFrameToBase64(Float32Array.from([1, -1]));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(bytes)).toEqual([255, 127, 0, 128]); // 32767 LE, -32768 LE
  });
});
