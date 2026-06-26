/**
 * AudioWorklet capture processor (architecture spec §5.1).
 *
 * Batches mono Float32 samples at the AudioContext's native rate and posts them
 * to the main thread (which resamples to 24 kHz and streams PCM16 to OpenAI).
 *
 * It also copies input → output, matching the canonical microphone-processing
 * pattern (web.dev) so the node is reliably pulled by the graph in every browser
 * (notably Firefox). The output is routed through a zero-gain node on the main
 * thread, so this passthrough is silent and causes no feedback.
 *
 * Plain dependency-free JS: AudioWorklet global scope has no ES module imports.
 */
const BATCH = 2048; // ~43 ms at 48 kHz

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.offset++] = channel[i];
        if (this.offset === BATCH) {
          const out = this.buffer.slice(0); // copy; this.buffer keeps filling
          this.port.postMessage(out, [out.buffer]);
          this.offset = 0;
        }
      }
      // Silent passthrough so the node is treated as a producing node.
      const outChannel = outputs[0] && outputs[0][0];
      if (outChannel) outChannel.set(channel.subarray(0, outChannel.length));
    }
    return true; // keep alive on a continuously open mic
  }
}

registerProcessor('capture-processor', CaptureProcessor);
