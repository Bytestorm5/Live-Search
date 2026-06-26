/**
 * AudioWorklet capture processor (architecture spec §5.1).
 *
 * Runs on the audio rendering thread so capture is never blocked by main-thread
 * UI jank. It batches mono Float32 samples at the AudioContext's native rate and
 * posts them to the main thread, which resamples to 24 kHz and streams PCM16 to
 * the OpenAI Realtime API. Plain dependency-free JS because AudioWorklet global
 * scope does not support ES module imports.
 *
 * No SharedArrayBuffer is used, so the page does not need cross-origin isolation.
 */
const BATCH = 2048; // ~43 ms at 48 kHz; keeps postMessage frequency reasonable

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === BATCH) {
        // Transfer a copy so we don't hand off our reused buffer.
        const out = this.buffer.slice(0);
        this.port.postMessage(out, [out.buffer]);
        this.offset = 0;
      }
    }
    return true; // keep alive on a continuously open mic
  }
}

registerProcessor('capture-processor', CaptureProcessor);
