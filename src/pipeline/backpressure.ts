/**
 * Bounded backpressure queue (architecture spec §9, §10).
 *
 * If utterances arrive faster than ASR can process them (low-end CPU, WASM
 * fallback), the queue applies a bounded policy: drop the OLDEST queued items
 * and keep the most recent, "since stale lookups are worthless". Dropped items
 * are counted so the UI can flag that it is falling behind (spec §10).
 */
export interface EnqueueResult<T> {
  /** Items evicted to make room (oldest first). */
  dropped: T[];
}

export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private _dropped = 0;

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error(`BoundedQueue: maxSize must be a positive integer, got ${maxSize}`);
    }
  }

  /** Add an item, evicting the oldest items if at capacity. */
  enqueue(item: T): EnqueueResult<T> {
    const dropped: T[] = [];
    this.items.push(item);
    while (this.items.length > this.maxSize) {
      dropped.push(this.items.shift() as T);
      this._dropped++;
    }
    return { dropped };
  }

  /** Remove and return the oldest item, or undefined if empty. */
  dequeue(): T | undefined {
    return this.items.shift();
  }

  /** The newest item still queued, without removing it. */
  peekNewest(): T | undefined {
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Total items dropped over the lifetime of the queue (spec §10). */
  get droppedCount(): number {
    return this._dropped;
  }

  /** Empty the queue (does not reset the dropped counter). */
  clear(): void {
    this.items.length = 0;
  }
}
