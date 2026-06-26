/**
 * Microphone capture wiring (architecture spec §5.1).
 *
 * Opens the mic with `getUserMedia`, routes it through the AudioWorklet capture
 * processor (web.dev canonical pattern), and delivers raw mono Float32 frames at
 * the AudioContext's native rate to a callback. The caller resamples to 24 kHz
 * and streams to OpenAI.
 *
 * The graph is mic → source → worklet → gain(0) → destination. The zero-gain
 * node keeps the worklet pulled in every browser without any audible feedback,
 * and the context is resumed (autoplay policy) before frames are expected.
 */

const WORKLET_URL = '/worklets/capture-processor.js';

export interface CaptureOptions {
  /** 'microphone' (default) or 'display' for shared tab/system audio. */
  source?: 'microphone' | 'display';
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
}

export interface CaptureHandle {
  /** Native sample rate of the captured audio (AudioContext rate). */
  sampleRate: number;
  stop(): Promise<void>;
}

/** Acquire an audio MediaStream from the mic or a shared tab/screen. */
async function acquireStream(options: CaptureOptions): Promise<MediaStream> {
  if (options.source === 'display') {
    // getDisplayMedia requires video; we use only the audio track. The user must
    // tick "Share audio" / "Share system audio" in the picker.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // we only need audio
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio was shared. Pick a tab or screen and enable "Share audio" / "Share system audio" (Chromium only).',
      );
    }
    return stream;
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
    },
  });
}

export async function startCapture(
  onFrame: (frame: Float32Array) => void,
  options: CaptureOptions = {},
): Promise<CaptureHandle> {
  const stream = await acquireStream(options);

  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(WORKLET_URL);
    // Resume BEFORE wiring/expecting frames — a context created after the
    // getUserMedia await can start suspended, and a suspended context never runs
    // the worklet (so no audio would ever be captured).
    if (context.state === 'suspended') await context.resume();
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

  // Zero-gain monitor: keeps the worklet pulled, emits no sound.
  const monitor = context.createGain();
  monitor.gain.value = 0;
  source.connect(node);
  node.connect(monitor);
  monitor.connect(context.destination);

  return {
    sampleRate: context.sampleRate,
    async stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      monitor.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}
