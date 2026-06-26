/**
 * Speech-recognition contract (architecture spec §5.3).
 *
 * The rest of the pipeline depends ONLY on this interface — never on a concrete
 * model. That is what makes "Moonshine vs. whisper-base.en" a deployment choice
 * rather than an architectural one (spec §5.3), and what lets the pure-logic
 * tests drive the pipeline with a deterministic fake model.
 */

/** A single recognized token plus the model's confidence in it (0..1). */
export interface Token {
  text: string;
  confidence: number;
}

/**
 * Result of transcribing one audio segment.
 *
 * `transcribe(Float32Array @16kHz) -> { text, tokens, isPartial }` — spec §5.3.
 * Only *committed* (non-partial) results trigger retrieval (spec §6.3).
 */
export interface TranscriptionResult {
  text: string;
  tokens: Token[];
  /** True for interim hypotheses shown for display only; false once committed. */
  isPartial: boolean;
}

/** Execution provider for ONNX Runtime Web (spec §5.3 "Execution provider selection"). */
export type ExecutionProvider = 'webgpu' | 'wasm';

/** Progress callback payload while model weights download / compile. */
export interface ModelLoadProgress {
  /** Human-readable stage or file name. */
  file: string;
  /** Bytes loaded so far (best effort; may be 0 when unknown). */
  loaded: number;
  /** Total bytes (best effort; may be 0 when unknown). */
  total: number;
  /** Normalized 0..1 progress. */
  progress: number;
  status: 'downloading' | 'loading' | 'ready';
}

/**
 * Common interface implemented by every ASR backend (Moonshine, Whisper, and
 * the test fake). Audio is always 16 kHz mono Float32 (spec §4, §5.1).
 */
export interface AsrModel {
  /** Stable identifier, e.g. "moonshine-base" or "whisper-base.en". */
  readonly id: string;
  /** The execution provider actually in use after {@link load}. */
  readonly provider: ExecutionProvider;
  /** Download + compile weights. Idempotent. */
  load(onProgress?: (p: ModelLoadProgress) => void): Promise<void>;
  /** Transcribe one 16 kHz mono segment. */
  transcribe(audio: Float32Array): Promise<TranscriptionResult>;
  /** Release GPU/WASM resources. */
  dispose(): Promise<void>;
}
