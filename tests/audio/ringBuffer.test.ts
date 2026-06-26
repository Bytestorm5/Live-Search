import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/audio/ringBuffer.ts';

describe('RingBuffer', () => {
  it('is empty on creation and reports usable capacity', () => {
    const rb = RingBuffer.create(16);
    expect(rb.availableRead()).toBe(0);
    // One slot is reserved to disambiguate full vs empty.
    expect(rb.usableCapacity).toBe(15);
    expect(rb.availableWrite()).toBe(15);
  });

  it('round-trips a written frame', () => {
    const rb = RingBuffer.create(64);
    const frame = Float32Array.from([0.1, -0.2, 0.3, -0.4]);
    expect(rb.write(frame)).toBe(4);
    expect(rb.availableRead()).toBe(4);

    const out = new Float32Array(4);
    expect(rb.read(out)).toBe(4);
    expect(Array.from(out)).toEqual(Array.from(frame));
    expect(rb.availableRead()).toBe(0);
  });

  it('reads only what fits in the destination and leaves the rest', () => {
    const rb = RingBuffer.create(64);
    rb.write(Float32Array.from([1, 2, 3, 4, 5]));
    const out = new Float32Array(2);
    expect(rb.read(out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 2]);
    expect(rb.availableRead()).toBe(3);
  });

  it('wraps around the end of the buffer correctly', () => {
    const rb = RingBuffer.create(8); // usable 7
    // Fill, drain most, then write across the wrap boundary.
    rb.write(Float32Array.from([1, 2, 3, 4, 5]));
    const drain = new Float32Array(4);
    rb.read(drain);
    expect(Array.from(drain)).toEqual([1, 2, 3, 4]);
    rb.write(Float32Array.from([6, 7, 8, 9])); // wraps past index 8
    const out = new Float32Array(5);
    expect(rb.read(out)).toBe(5);
    expect(Array.from(out)).toEqual([5, 6, 7, 8, 9]);
  });

  it('drops overflow when full and counts dropped samples', () => {
    const rb = RingBuffer.create(8); // usable 7
    const written = rb.write(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(written).toBe(7);
    expect(rb.dropped).toBe(3);
    expect(rb.availableWrite()).toBe(0);
  });

  it('shares state across two views over the same SharedArrayBuffer', () => {
    const producer = RingBuffer.create(32);
    const consumer = new RingBuffer(producer.sab);
    producer.write(Float32Array.from([9, 8, 7]));
    const out = new Float32Array(3);
    expect(consumer.read(out)).toBe(3);
    expect(Array.from(out)).toEqual([9, 8, 7]);
  });

  it('survives many wrap cycles without corruption', () => {
    const rb = RingBuffer.create(16); // usable 15
    let next = 0;
    let expected = 0;
    const scratch = new Float32Array(10);
    for (let cycle = 0; cycle < 1000; cycle++) {
      const n = (cycle % 7) + 1;
      const frame = new Float32Array(n);
      for (let i = 0; i < n; i++) frame[i] = next++;
      rb.write(frame);
      const got = rb.read(scratch.subarray(0, n));
      for (let i = 0; i < got; i++) {
        expect(scratch[i]).toBe(expected++);
      }
    }
  });
});
