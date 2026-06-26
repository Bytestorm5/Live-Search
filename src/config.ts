/**
 * Central tunables. Defaults come straight from the architecture spec; every
 * value the spec calls "tunable" or "default" is surfaced here so the UI
 * (spec §5.6) and tests can override it in one place.
 */

export interface AudioConfig {
  /** Target sample rate fed to VAD + ASR (spec §4, §5.1). */
  sampleRate: number;
  /** Ring-buffer capacity in seconds of audio (spec §4 "ring buffer"). */
  ringBufferSeconds: number;
}

export interface VadConfig {
  /**
   * Silero speech-probability threshold above which a frame counts as speech.
   * Higher = less sensitive (spec §5.2 "speech-onset sensitivity").
   */
  speechThreshold: number;
  /** Hysteresis: drop back to silence below this (avoids flicker at onset). */
  silenceThreshold: number;
  /** Samples per VAD window — 512 @16kHz ≈ 32 ms (spec §5.2 "~30 ms windows"). */
  frameSamples: number;
  /** End-of-utterance trailing silence, ms (spec §5.2 default 400). */
  endOfUtteranceSilenceMs: number;
  /** Reject blips (coughs/clicks) shorter than this, ms (spec §5.2). */
  minUtteranceMs: number;
  /** Force an incremental cut on long monologues, ms (spec §5.2 default 15000). */
  maxUtteranceMs: number;
  /** Keep this much pre-speech audio so onsets aren't clipped, ms. */
  preSpeechPaddingMs: number;
}

export interface AsrConfig {
  /** Default model id; resolved to a concrete backend at load. */
  model: 'moonshine-tiny' | 'moonshine-base' | 'whisper-base.en';
  /** Preferred execution provider; falls back to wasm if webgpu is absent. */
  preferredProvider: 'webgpu' | 'wasm';
  /** Emit interim partial hypotheses for display (spec §5.3, §6.3). */
  emitPartials: boolean;
}

export interface CorrectionConfig {
  /** Max Damerau-Levenshtein distance for a fuzzy vocab match (spec §5.4). */
  maxEditDistance: number;
  /** Ignore candidate terms shorter than this (too noisy to correct). */
  minTermLength: number;
  /**
   * Accept a fuzzy match only when normalized similarity ≥ this, OR the
   * phonetic keys match and distance ≤ maxEditDistance (spec §5.4).
   */
  minSimilarity: number;
}

export interface RetrievalConfig {
  /** Number of results shown (spec §5.6 "result count"). */
  topK: number;
  /** Reciprocal-rank-fusion constant (spec §5.5 "Fusion"). */
  rrfK: number;
  /** BM25 term-saturation parameter. */
  bm25K1: number;
  /** BM25 length-normalization parameter. */
  bm25B: number;
  /** Rolling transcript window length, in characters (spec §5.5, §6). */
  transcriptWindowChars: number;
  /** Chunk size in tokens when ingesting docs (spec §5.5). */
  chunkSizeTokens: number;
  /** Overlap between adjacent chunks, in tokens. */
  chunkOverlapTokens: number;
}

export interface BackpressureConfig {
  /** Max queued utterances before the bounded drop policy kicks in (spec §9). */
  maxQueue: number;
}

export interface AppConfig {
  audio: AudioConfig;
  vad: VadConfig;
  asr: AsrConfig;
  correction: CorrectionConfig;
  retrieval: RetrievalConfig;
  backpressure: BackpressureConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  audio: {
    sampleRate: 16_000,
    ringBufferSeconds: 30,
  },
  vad: {
    speechThreshold: 0.5,
    silenceThreshold: 0.35,
    frameSamples: 512,
    endOfUtteranceSilenceMs: 400,
    minUtteranceMs: 200,
    maxUtteranceMs: 15_000,
    preSpeechPaddingMs: 200,
  },
  asr: {
    model: 'moonshine-base',
    preferredProvider: 'webgpu',
    emitPartials: false,
  },
  correction: {
    maxEditDistance: 2,
    minTermLength: 3,
    minSimilarity: 0.72,
  },
  retrieval: {
    topK: 5,
    rrfK: 60,
    bm25K1: 1.5,
    bm25B: 0.75,
    transcriptWindowChars: 400,
    chunkSizeTokens: 120,
    chunkOverlapTokens: 30,
  },
  backpressure: {
    maxQueue: 4,
  },
};

/** Deep-merge a partial override onto {@link DEFAULT_CONFIG}. */
export function makeConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  return {
    audio: { ...DEFAULT_CONFIG.audio, ...overrides.audio },
    vad: { ...DEFAULT_CONFIG.vad, ...overrides.vad },
    asr: { ...DEFAULT_CONFIG.asr, ...overrides.asr },
    correction: { ...DEFAULT_CONFIG.correction, ...overrides.correction },
    retrieval: { ...DEFAULT_CONFIG.retrieval, ...overrides.retrieval },
    backpressure: { ...DEFAULT_CONFIG.backpressure, ...overrides.backpressure },
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
