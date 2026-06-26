/**
 * AudioWorklet capture processor (architecture spec §5.1).
 *
 * Runs on the audio rendering thread so capture is never blocked by main-thread
 * UI jank. It writes mono Float32 frames at the AudioContext's native sample
 * rate into a lock-free SharedArrayBuffer ring buffer; downsampling to 16 kHz is
 * done downstream in the VAD worker (reusing the tested Resampler).
 *
 * This file is intentionally plain, dependency-free JavaScript: AudioWorklet
 * global scope does not support ES module imports, so the ring-buffer write is
 * inlined here. Its memory layout MUST match src/audio/ringBuffer.ts:
 *   Int32 header [write, read, dropped, storageCapacity] then Float32 data.
 */

const I_WRITE = 0;
const I_READ = 1;
const I_DROPPED = 2;
const I_CAPACITY = 3;
const HEADER_INTS = 4;
const HEADER_BYTES = HEADER_INTS * 4;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sab = options.processorOptions.sab;
    this.header = new Int32Array(sab, 0, HEADER_INTS);
    this.capacity = Atomics.load(this.header, I_CAPACITY);
    this.data = new Float32Array(sab, HEADER_BYTES, this.capacity);
  }

  availableWrite() {
    const w = Atomics.load(this.header, I_WRITE);
    const r = Atomics.load(this.header, I_READ);
    const used = (w - r + this.capacity) % this.capacity;
    return this.capacity - 1 - used;
  }

  write(frame) {
    const free = this.availableWrite();
    const toWrite = Math.min(free, frame.length);
    if (toWrite > 0) {
      let w = Atomics.load(this.header, I_WRITE);
      const firstChunk = Math.min(toWrite, this.capacity - w);
      this.data.set(frame.subarray(0, firstChunk), w);
      if (firstChunk < toWrite) this.data.set(frame.subarray(firstChunk, toWrite), 0);
      w = (w + toWrite) % this.capacity;
      Atomics.store(this.header, I_WRITE, w);
    }
    const overflow = frame.length - toWrite;
    if (overflow > 0) Atomics.add(this.header, I_DROPPED, overflow);
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      this.write(input[0]); // channel 0 (mono)
    }
    return true; // keep the processor alive on a continuously open mic
  }
}

registerProcessor('capture-processor', CaptureProcessor);
