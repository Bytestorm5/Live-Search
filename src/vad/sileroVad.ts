/**
 * Silero VAD wrapper (architecture spec §5.2, §8). Runs the ~2 MB Silero model
 * via ONNX Runtime Web on the WASM backend — it is small enough to run on the
 * CPU without contending for the GPU, which the ASR model needs.
 *
 * It exposes a single {@link process} call returning the speech probability for
 * one frame; the stateful RNN hidden state is carried internally. The pure
 * segmentation logic that consumes these probabilities lives in
 * {@link ../vad/segmenter.ts}.
 */
import * as ort from 'onnxruntime-web';
// Bundled as a same-origin asset by Vite (served from /assets). This keeps the
// VAD model self-hosted with no setup step and no CDN entry in the CSP — it
// satisfies both the default and the strict/air-gapped privacy modes (spec §7).
import bundledSileroUrl from './silero_vad.onnx?url';

export interface SileroVadOptions {
  /** Override the model URL; defaults to the bundled same-origin asset. */
  modelUrl?: string;
  ortWasmPath?: string;
  sampleRate?: number;
}

export class SileroVad {
  private session: ort.InferenceSession | null = null;
  private state: ort.Tensor;
  private sr: ort.Tensor;
  private readonly modelUrl: string;
  private readonly sampleRate: number;

  // Default Silero v5 I/O names; re-mapped from the session after load.
  private inputName = 'input';
  private stateName = 'state';
  private srName = 'sr';
  private probOut = 'output';
  private stateOut = 'stateN';

  constructor(opts: SileroVadOptions = {}) {
    this.modelUrl = opts.modelUrl || bundledSileroUrl;
    this.sampleRate = opts.sampleRate ?? 16_000;
    if (opts.ortWasmPath) ort.env.wasm.wasmPaths = opts.ortWasmPath;
    this.state = SileroVad.zeroState();
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(this.sampleRate)]), []);
  }

  private static zeroState(): ort.Tensor {
    return new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  }

  /** Reset the RNN state (e.g. between sessions). */
  resetState(): void {
    this.state = SileroVad.zeroState();
  }

  async load(): Promise<void> {
    if (this.session) return;
    this.session = await ort.InferenceSession.create(this.modelUrl, {
      executionProviders: ['wasm'],
    });
    this.remapIoNames(this.session);
  }

  /** Adapt to small naming differences between Silero export versions. */
  private remapIoNames(session: ort.InferenceSession): void {
    const ins = session.inputNames;
    const outs = session.outputNames;
    if (!ins.includes(this.inputName)) {
      this.inputName = ins.find((n) => n !== 'sr' && n !== 'state' && n !== 'h' && n !== 'c') ?? ins[0];
    }
    if (!ins.includes(this.stateName)) {
      this.stateName = ins.find((n) => n === 'state' || n === 'h') ?? this.stateName;
    }
    if (!ins.includes(this.srName)) {
      this.srName = ins.find((n) => n === 'sr') ?? this.srName;
    }
    if (!outs.includes(this.probOut)) this.probOut = outs[0];
    if (!outs.includes(this.stateOut)) this.stateOut = outs.find((n) => n !== this.probOut) ?? this.stateOut;
  }

  /** Return P(speech) in [0, 1] for one frame, updating internal state. */
  async process(frame: Float32Array): Promise<number> {
    if (!this.session) await this.load();
    const input = new ort.Tensor('float32', frame, [1, frame.length]);
    const feeds: Record<string, ort.Tensor> = {
      [this.inputName]: input,
      [this.srName]: this.sr,
      [this.stateName]: this.state,
    };
    const results = await this.session!.run(feeds);
    const newState = results[this.stateOut];
    if (newState) this.state = newState;
    const probTensor = results[this.probOut];
    const data = probTensor.data as Float32Array;
    return data[data.length - 1];
  }

  async dispose(): Promise<void> {
    await this.session?.release?.();
    this.session = null;
  }
}
