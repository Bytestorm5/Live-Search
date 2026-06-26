/**
 * Central tunables. Transcription is provided by the OpenAI Realtime API
 * (server-side VAD + ASR); documentation retrieval runs locally. Defaults aim
 * for "works immediately, no client model downloads": lexical search is on,
 * semantic (local MiniLM, ~25 MB) is opt-in.
 */
import type { NoiseReduction, TranscriptionModel } from './asr/realtimeEvents.ts';

export interface AudioConfig {
  /** Sample rate we resample to before sending to OpenAI (their PCM rate). */
  targetSampleRate: number;
}

export interface TranscriptionConfig {
  model: TranscriptionModel;
  /** Language hint (e.g. "en"); empty string = auto-detect. */
  language: string;
  /** Server-side VAD turn detection (segments utterances for us). */
  serverVad: boolean;
  noiseReduction: NoiseReduction;
}

export interface CorrectionConfig {
  /** Max Damerau-Levenshtein distance for a fuzzy vocab match (spec §5.4). */
  maxEditDistance: number;
  /** Ignore candidate terms shorter than this. */
  minTermLength: number;
  /** Accept a fuzzy match at/above this similarity, or on a phonetic match. */
  minSimilarity: number;
}

export interface RetrievalConfig {
  /** Number of results shown (spec §5.6). */
  topK: number;
  /** Reciprocal-rank-fusion constant (spec §5.5). */
  rrfK: number;
  bm25K1: number;
  bm25B: number;
  /** Rolling transcript window length, in characters (spec §5.5, §6). */
  transcriptWindowChars: number;
  /** Chunk size in tokens when ingesting docs (spec §5.5). */
  chunkSizeTokens: number;
  /** Overlap between adjacent chunks, in tokens. */
  chunkOverlapTokens: number;
  /** Enable local semantic (MiniLM) retrieval. Off by default = no downloads. */
  semantic: boolean;
}

export interface AppConfig {
  audio: AudioConfig;
  transcription: TranscriptionConfig;
  correction: CorrectionConfig;
  retrieval: RetrievalConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  audio: {
    targetSampleRate: 24_000,
  },
  transcription: {
    model: 'gpt-4o-mini-transcribe',
    language: 'en',
    serverVad: true,
    noiseReduction: 'near_field',
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
    semantic: false,
  },
};

/** Deep-merge a partial override onto {@link DEFAULT_CONFIG}. */
export function makeConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  return {
    audio: { ...DEFAULT_CONFIG.audio, ...overrides.audio },
    transcription: { ...DEFAULT_CONFIG.transcription, ...overrides.transcription },
    correction: { ...DEFAULT_CONFIG.correction, ...overrides.correction },
    retrieval: { ...DEFAULT_CONFIG.retrieval, ...overrides.retrieval },
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
