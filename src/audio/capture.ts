/**
 * Microphone capture wiring (architecture spec §5.1).
 *
 * Opens the mic with `getUserMedia`, routes it through the AudioWorklet capture
 * processor, and exposes the resulting ring buffer. Audio stays in memory and is
 * never written to disk or transmitted (spec §7). The worklet writes at the
 * AudioContext's native rate; the VAD worker resamples to 16 kHz.
 */
import type { AppConfig } from '../config.ts';
import { RingBuffer } from './ringBuffer.ts';

const WORKLET_URL = '/worklets/capture-processor.js';

export interface CaptureOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
}

export interface CaptureHandle {
  ringBuffer: RingBuffer;
  /** Native sample rate of the captured audio (AudioContext rate). */
  sampleRate: number;
  stop(): Promise<void>;
}

export async function startCapture(config: AppConfig, options: CaptureOptions = {}): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
    },
  });

  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(WORKLET_URL);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw err;
  }

  // Storage capacity = N seconds at the native rate, plus the reserved slot.
  const capacity = Math.ceil(config.audio.ringBufferSeconds * context.sampleRate) + 1;
  const ringBuffer = RingBuffer.create(capacity);

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sab: ringBuffer.sab },
  });

  source.connect(node);
  // Connect to destination so the graph is pulled; the node emits silence.
  node.connect(context.destination);

  return {
    ringBuffer,
    sampleRate: context.sampleRate,
    async stop() {
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}
