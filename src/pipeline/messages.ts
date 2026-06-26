/**
 * Typed messages exchanged between the UI thread and the Web Workers
 * (architecture spec §3, §9). Audio payloads are sent as transferable
 * `Float32Array` buffers so no copy is made crossing the worker boundary.
 */
import type { AppConfig, AsrConfig, VadConfig } from '../config.ts';
import type { CorpusIndex, SearchHit } from '../retrieval/types.ts';
import type { SegmentReason } from '../vad/segmenter.ts';
import type { ExecutionProvider, Token } from '../asr/types.ts';

/** A committed utterance crossing a worker boundary. */
export interface SegmentMessage {
  id: number;
  audio: Float32Array;
  startSample: number;
  endSample: number;
  durationMs: number;
  reason: SegmentReason;
  isFinal: boolean;
}

// --- VAD worker ---

export type VadInbound =
  | { type: 'init'; sab: SharedArrayBuffer; inputSampleRate: number; targetSampleRate: number; vad: VadConfig; ortBasePath: string; modelUrl?: string }
  | { type: 'start' }
  | { type: 'stop' };

export type VadOutbound =
  | { type: 'ready' }
  | { type: 'state'; speaking: boolean }
  | { type: 'segment'; segment: SegmentMessage }
  | { type: 'error'; message: string };

// --- ASR worker ---

export type AsrInbound =
  | { type: 'load'; model: AsrConfig['model']; preferredProvider: ExecutionProvider; maxQueue: number; modelEnv: ModelEnv }
  | { type: 'segment'; segment: SegmentMessage }
  | { type: 'reset' };

export type AsrOutbound =
  | { type: 'ready'; provider: ExecutionProvider; model: string }
  | { type: 'progress'; file: string; progress: number; status: string }
  | { type: 'result'; id: number; text: string; tokens: Token[]; isPartial: boolean; reason: SegmentReason }
  | { type: 'falling-behind'; dropped: number }
  | { type: 'error'; message: string };

// --- Retrieval worker ---

export type RetrievalInbound =
  | { type: 'loadIndex'; index: CorpusIndex; config: AppConfig; useSemantic: boolean; provider: ExecutionProvider; modelEnv: ModelEnv }
  | { type: 'query'; id: number; text: string; transcriptWindow: string; excludeChunkIds: string[] };

export type RetrievalOutbound =
  | { type: 'ready'; hasSemantic: boolean; chunkCount: number }
  | { type: 'progress'; progress: number; status: string }
  | { type: 'results'; id: number; hits: SearchHit[]; rawTerms: string[]; correctedTerms: string[] }
  | { type: 'error'; message: string };

/** Model-loading environment forwarded to workers (self-host vs. remote). */
export interface ModelEnv {
  allowRemoteModels: boolean;
  localModelPath: string;
  ortWasmPath: string;
}
