/**
 * Microphone capture wiring (architecture spec §5.1).
 *
 * Opens the mic with `getUserMedia`, routes it through the AudioWorklet capture
 * processor, and delivers raw mono Float32 frames (at the AudioContext's native
 * rate) to a callback. The caller resamples to 24 kHz and streams to OpenAI.
 */

const WORKLET_URL = '/worklets/capture-processor.js';

export interface CaptureOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
}

export interface CaptureHandle {
  /** Native sample rate of the captured audio (AudioContext rate). */
  sampleRate: number;
  stop(): Promise<void>;
}

/** Start capturing; `onFrame` receives native-rate mono Float32 frames. */
export async function startCapture(
  onFrame: (frame: Float32Array) => void,
  options: CaptureOptions = {},
): Promise<CaptureHandle> {
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

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);

  source.connect(node);
  node.connect(context.destination); // keep the graph pulled; node emits silence

  return {
    sampleRate: context.sampleRate,
    async stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}
