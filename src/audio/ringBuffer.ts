/**
 * Lock-free single-producer / single-consumer ring buffer of Float32 audio
 * samples backed by a {@link SharedArrayBuffer} (architecture spec §4, §5.1).
 *
 * The AudioWorklet (producer, audio rendering thread) writes 16 kHz mono frames;
 * the VAD worker (consumer) reads them. Only the producer ever advances the
 * write index and only the consumer ever advances the read index, so no lock is
 * required — `Atomics` provides the publish/observe ordering between threads.
 *
 * Layout of the SharedArrayBuffer:
 *
 *   Int32 header (16 bytes):
 *     [0] write index   (samples, modulo storage capacity)
 *     [1] read index    (samples, modulo storage capacity)
 *     [2] dropped count  (samples discarded because the buffer was full)
 *     [3] storage capacity (number of Float32 slots in the data region)
 *   Float32 data region: `storageCapacity` samples.
 *
 * One slot is always left empty so `read == write` unambiguously means "empty".
 * Usable capacity is therefore `storageCapacity - 1`.
 */

const HEADER_INTS = 4;
const I_WRITE = 0;
const I_READ = 1;
const I_DROPPED = 2;
const I_CAPACITY = 3;
const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

export class RingBuffer {
  private readonly header: Int32Array;
  private readonly data: Float32Array;
  /** Number of physical Float32 slots (usable capacity is this minus one). */
  readonly storageCapacity: number;

  constructor(sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, HEADER_INTS);
    this.storageCapacity = Atomics.load(this.header, I_CAPACITY);
    if (this.storageCapacity <= 1) {
      throw new Error('RingBuffer: SharedArrayBuffer has no capacity header; create it with RingBuffer.create()');
    }
    this.data = new Float32Array(sab, HEADER_BYTES, this.storageCapacity);
  }

  /**
   * Allocate a new ring buffer with `capacitySamples` storage slots. One slot is
   * reserved to disambiguate full vs. empty, so usable capacity is
   * `capacitySamples - 1`.
   */
  static create(capacitySamples: number): RingBuffer {
    if (!Number.isInteger(capacitySamples) || capacitySamples < 2) {
      throw new Error(`RingBuffer.create: capacity must be an integer >= 2, got ${capacitySamples}`);
    }
    const storage = capacitySamples;
    const sab = new SharedArrayBuffer(HEADER_BYTES + storage * Float32Array.BYTES_PER_ELEMENT);
    const header = new Int32Array(sab, 0, HEADER_INTS);
    Atomics.store(header, I_CAPACITY, storage);
    return new RingBuffer(sab);
  }

  /** The underlying buffer, for posting to a worker. */
  get sab(): SharedArrayBuffer {
    return this.header.buffer as SharedArrayBuffer;
  }

  /** Number of samples that can be stored at once. */
  get usableCapacity(): number {
    return this.storageCapacity - 1;
  }

  /** Total samples discarded so far because the buffer was full (spec §9, §10). */
  get dropped(): number {
    return Atomics.load(this.header, I_DROPPED);
  }

  /** Samples currently available to read. */
  availableRead(): number {
    const w = Atomics.load(this.header, I_WRITE);
    const r = Atomics.load(this.header, I_READ);
    return (w - r + this.storageCapacity) % this.storageCapacity;
  }

  /** Free slots available to write. */
  availableWrite(): number {
    return this.usableCapacity - this.availableRead();
  }

  /**
   * Write a frame. Writes as many samples as fit; any overflow is discarded and
   * added to {@link dropped} (capture must never block — spec §5.1, §9).
   * Returns the number of samples actually written.
   */
  write(frame: Float32Array): number {
    const free = this.availableWrite();
    const toWrite = Math.min(free, frame.length);
    const overflow = frame.length - toWrite;
    if (toWrite > 0) {
      let w = Atomics.load(this.header, I_WRITE);
      const cap = this.storageCapacity;
      const firstChunk = Math.min(toWrite, cap - w);
      this.data.set(frame.subarray(0, firstChunk), w);
      if (firstChunk < toWrite) {
        this.data.set(frame.subarray(firstChunk, toWrite), 0);
      }
      w = (w + toWrite) % cap;
      // Publish the new write index AFTER the data is in place.
      Atomics.store(this.header, I_WRITE, w);
    }
    if (overflow > 0) {
      Atomics.add(this.header, I_DROPPED, overflow);
    }
    return toWrite;
  }

  /**
   * Read up to `out.length` samples into `out`. Returns the number read (may be
   * fewer than requested, including 0).
   */
  read(out: Float32Array): number {
    const avail = this.availableRead();
    const toRead = Math.min(avail, out.length);
    if (toRead > 0) {
      let r = Atomics.load(this.header, I_READ);
      const cap = this.storageCapacity;
      const firstChunk = Math.min(toRead, cap - r);
      out.set(this.data.subarray(r, r + firstChunk), 0);
      if (firstChunk < toRead) {
        out.set(this.data.subarray(0, toRead - firstChunk), firstChunk);
      }
      r = (r + toRead) % cap;
      // Publish the new read index AFTER the data is copied out.
      Atomics.store(this.header, I_READ, r);
    }
    return toRead;
  }

  /** Discard all buffered samples (does not reset the dropped counter). */
  clear(): void {
    Atomics.store(this.header, I_READ, Atomics.load(this.header, I_WRITE));
  }
}
