import { describe, it, expect } from 'vitest';
import { BoundedQueue } from '../../src/pipeline/backpressure.ts';

describe('BoundedQueue', () => {
  it('rejects an invalid max size', () => {
    expect(() => new BoundedQueue(0)).toThrow();
  });

  it('enqueues and dequeues FIFO', () => {
    const q = new BoundedQueue<number>(4);
    q.enqueue(1);
    q.enqueue(2);
    expect(q.size).toBe(2);
    expect(q.dequeue()).toBe(1);
    expect(q.dequeue()).toBe(2);
    expect(q.dequeue()).toBeUndefined();
  });

  it('drops the oldest items when over capacity, keeping the newest', () => {
    const q = new BoundedQueue<number>(2);
    expect(q.enqueue(1).dropped).toEqual([]);
    expect(q.enqueue(2).dropped).toEqual([]);
    const r = q.enqueue(3); // over capacity -> drop oldest (1)
    expect(r.dropped).toEqual([1]);
    expect(q.size).toBe(2);
    expect(q.droppedCount).toBe(1);
    // The two newest remain.
    expect(q.dequeue()).toBe(2);
    expect(q.dequeue()).toBe(3);
  });

  it('tracks the newest item and full/empty state', () => {
    const q = new BoundedQueue<string>(2);
    expect(q.isEmpty).toBe(true);
    q.enqueue('a');
    q.enqueue('b');
    expect(q.isFull).toBe(true);
    expect(q.peekNewest()).toBe('b');
  });

  it('accumulates the dropped count across many overflows', () => {
    const q = new BoundedQueue<number>(1);
    for (let i = 0; i < 5; i++) q.enqueue(i);
    expect(q.droppedCount).toBe(4);
    expect(q.dequeue()).toBe(4); // only the newest survives
  });

  it('clear() empties without resetting the dropped counter', () => {
    const q = new BoundedQueue<number>(1);
    q.enqueue(1);
    q.enqueue(2); // drops 1
    q.clear();
    expect(q.isEmpty).toBe(true);
    expect(q.droppedCount).toBe(1);
  });
});
