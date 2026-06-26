/**
 * ASR backend implemented with Transformers.js + ONNX Runtime Web (architecture
 * spec §5.3, §8). Both Moonshine and whisper-base.en are exposed through this
 * one class because they share the `automatic-speech-recognition` pipeline — the
 * model choice is a deployment decision, not an architectural one (spec §5.3).
 *
 * Implements the {@link AsrModel} contract the rest of the pipeline depends on.
 */
import type { AsrModel, ExecutionProvider, ModelLoadProgress, TranscriptionResult } from './types.ts';

/** Minimal shape we rely on from the ASR pipeline. */
type AsrPipe = ((audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text?: string }>) & {
  dispose?: () => Promise<void>;
};

interface ProgressInfo {
  status?: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface TransformersAsrOptions {
  /** Logical id, e.g. "moonshine-base". */
  id: string;
  /** Hugging Face repo id of the ONNX model. */
  modelId: string;
  provider: ExecutionProvider;
  /** Quantization/precision passed to the pipeline (e.g. "fp32", "q8"). */
  dtype?: string;
}

function toProgress(info: ProgressInfo): ModelLoadProgress {
  const status: ModelLoadProgress['status'] =
    info.status === 'ready' || info.status === 'done' ? 'ready' : info.status === 'progress' ? 'downloading' : 'loading';
  return {
    file: info.file ?? info.name ?? '',
    loaded: info.loaded ?? 0,
    total: info.total ?? 0,
    progress: (info.progress ?? 0) / 100,
    status,
  };
}

export class TransformersAsrModel implements AsrModel {
  readonly id: string;
  readonly provider: ExecutionProvider;
  private readonly modelId: string;
  private readonly dtype?: string;
  private pipe: AsrPipe | null = null;
  private loading: Promise<void> | null = null;

  constructor(opts: TransformersAsrOptions) {
    this.id = opts.id;
    this.modelId = opts.modelId;
    this.provider = opts.provider;
    if (opts.dtype) this.dtype = opts.dtype;
  }

  async load(onProgress?: (p: ModelLoadProgress) => void): Promise<void> {
    if (this.pipe) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const options: Record<string, unknown> = {
        device: this.provider,
        progress_callback: (info: ProgressInfo) => onProgress?.(toProgress(info)),
      };
      if (this.dtype) options.dtype = this.dtype;
      const pipe = await pipeline('automatic-speech-recognition', this.modelId, options);
      this.pipe = pipe as unknown as AsrPipe;
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async transcribe(audio: Float32Array): Promise<TranscriptionResult> {
    if (!this.pipe) await this.load();
    const out = await this.pipe!(audio);
    const text = (out?.text ?? '').trim();
    // Per-token confidence is not exposed by the high-level pipeline; we surface
    // word tokens with a neutral confidence so the contract (§5.3) holds.
    const tokens = text ? text.split(/\s+/).map((t) => ({ text: t, confidence: 1 })) : [];
    return { text, tokens, isPartial: false };
  }

  async dispose(): Promise<void> {
    await this.pipe?.dispose?.();
    this.pipe = null;
  }
}
