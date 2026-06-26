/**
 * Pipeline orchestrator (architecture spec §3, §4, §9).
 *
 * Owns the one-directional audio pipeline on the UI thread: it starts capture,
 * spawns the VAD / ASR / retrieval workers, and routes messages between them:
 *
 *   capture → ring buffer → VAD worker → ASR worker → retrieval worker → UI
 *
 * It also keeps the only cross-utterance state: the rolling transcript window
 * and the set of chunks already on screen (for de-duplication, spec §4 step 5).
 */
import type { AppConfig } from '../config.ts';
import { selectProvider } from '../asr/provider.ts';
import type { ExecutionProvider } from '../asr/types.ts';
import { startCapture } from '../audio/capture.ts';
import type { CaptureHandle } from '../audio/capture.ts';
import { MODEL_ENV, SILERO_VAD_URL } from '../modelEnv.ts';
import type { CorpusIndex, SearchHit } from '../retrieval/types.ts';
import type { SegmentReason } from '../vad/segmenter.ts';
import { RollingTranscript } from './transcript.ts';
import type {
  AsrInbound,
  AsrOutbound,
  RetrievalInbound,
  RetrievalOutbound,
  VadInbound,
  VadOutbound,
} from './messages.ts';

export interface PipelineStatus {
  micActive: boolean;
  speaking: boolean;
  provider: ExecutionProvider | null;
  asrModel: string | null;
  asrReady: boolean;
  vadReady: boolean;
  retrievalReady: boolean;
  hasSemantic: boolean;
  modelProgress: number;
  fallingBehind: boolean;
  droppedCount: number;
}

export interface TranscriptEntry {
  text: string;
  reason: SegmentReason;
}

export interface ResultsInfo {
  rawTerms: string[];
  correctedTerms: string[];
}

export interface OrchestratorCallbacks {
  onStatus(status: PipelineStatus): void;
  onTranscript(entry: TranscriptEntry): void;
  onResults(hits: SearchHit[], info: ResultsInfo): void;
  onError(message: string): void;
}

export class Orchestrator {
  private readonly config: AppConfig;
  private readonly index: CorpusIndex | null;
  private readonly cb: OrchestratorCallbacks;

  private capture: CaptureHandle | null = null;
  private vadWorker: Worker | null = null;
  private asrWorker: Worker | null = null;
  private retrievalWorker: Worker | null = null;

  private readonly transcript: RollingTranscript;
  private displayed: SearchHit[] = [];
  private shownIds = new Set<string>();
  private queryId = 0;
  private started = false;

  private asrProgress = 0;
  private embedProgress = 0;

  private status: PipelineStatus = {
    micActive: false,
    speaking: false,
    provider: null,
    asrModel: null,
    asrReady: false,
    vadReady: false,
    retrievalReady: false,
    hasSemantic: false,
    modelProgress: 0,
    fallingBehind: false,
    droppedCount: 0,
  };

  constructor(config: AppConfig, index: CorpusIndex | null, callbacks: OrchestratorCallbacks) {
    this.config = config;
    this.index = index;
    this.cb = callbacks;
    this.transcript = new RollingTranscript(config.retrieval.transcriptWindowChars);
  }

  /** True once retrieval is wired (an index was provided). */
  get hasRetrieval(): boolean {
    return this.index !== null;
  }

  private emitStatus(patch: Partial<PipelineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.status.modelProgress = (this.asrProgress + this.embedProgress) / (this.hasRetrieval ? 2 : 1);
    this.cb.onStatus(this.status);
  }

  /** Start capture + workers and begin listening. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const provider = await selectProvider(this.config.asr.preferredProvider);
      this.emitStatus({ provider });

      this.startRetrievalWorker(provider);
      this.startAsrWorker();

      this.capture = await startCapture(this.config);
      this.emitStatus({ micActive: true });

      this.startVadWorker();
    } catch (err) {
      this.cb.onError(`Failed to start: ${String(err)}`);
      await this.stop();
    }
  }

  /** Stop listening and tear everything down. */
  async stop(): Promise<void> {
    this.started = false;
    this.vadWorker?.postMessage({ type: 'stop' } satisfies VadInbound);
    await this.capture?.stop();
    this.capture = null;
    this.vadWorker?.terminate();
    this.asrWorker?.terminate();
    this.retrievalWorker?.terminate();
    this.vadWorker = this.asrWorker = this.retrievalWorker = null;
    this.transcript.clear();
    this.displayed = [];
    this.shownIds.clear();
    this.emitStatus({ micActive: false, speaking: false, asrReady: false, vadReady: false, retrievalReady: false });
  }

  // --- workers ---

  private startRetrievalWorker(provider: ExecutionProvider): void {
    if (!this.index) return;
    const worker = new Worker(new URL('../retrieval/retrieval.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RetrievalOutbound>) => this.onRetrieval(e.data);
    worker.onerror = (e) => this.cb.onError(`Retrieval worker error: ${e.message}`);
    const load: RetrievalInbound = {
      type: 'loadIndex',
      index: this.index,
      config: this.config,
      useSemantic: true,
      provider,
      modelEnv: MODEL_ENV,
    };
    worker.postMessage(load);
    this.retrievalWorker = worker;
  }

  private startAsrWorker(): void {
    const worker = new Worker(new URL('../asr/asr.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AsrOutbound>) => this.onAsr(e.data);
    worker.onerror = (e) => this.cb.onError(`ASR worker error: ${e.message}`);
    const load: AsrInbound = {
      type: 'load',
      model: this.config.asr.model,
      preferredProvider: this.config.asr.preferredProvider,
      maxQueue: this.config.backpressure.maxQueue,
      modelEnv: MODEL_ENV,
    };
    worker.postMessage(load);
    this.asrWorker = worker;
  }

  private startVadWorker(): void {
    if (!this.capture) return;
    const worker = new Worker(new URL('../vad/vad.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<VadOutbound>) => this.onVad(e.data);
    worker.onerror = (e) => this.cb.onError(`VAD worker error: ${e.message}`);
    const init: VadInbound = {
      type: 'init',
      sab: this.capture.ringBuffer.sab,
      inputSampleRate: this.capture.sampleRate,
      targetSampleRate: this.config.audio.sampleRate,
      vad: this.config.vad,
      modelUrl: SILERO_VAD_URL,
      ortBasePath: MODEL_ENV.ortWasmPath,
    };
    worker.postMessage(init);
    this.vadWorker = worker;
  }

  private maybeStartListening(): void {
    if (this.status.vadReady && this.status.asrReady) {
      this.vadWorker?.postMessage({ type: 'start' } satisfies VadInbound);
    }
  }

  // --- message handlers ---

  private onVad(msg: VadOutbound): void {
    switch (msg.type) {
      case 'ready':
        this.emitStatus({ vadReady: true });
        this.maybeStartListening();
        break;
      case 'state':
        this.emitStatus({ speaking: msg.speaking });
        break;
      case 'segment':
        // Forward committed audio to ASR, transferring the buffer (no copy).
        this.asrWorker?.postMessage({ type: 'segment', segment: msg.segment } satisfies AsrInbound, [
          msg.segment.audio.buffer,
        ]);
        break;
      case 'error':
        this.cb.onError(msg.message);
        break;
    }
  }

  private onAsr(msg: AsrOutbound): void {
    switch (msg.type) {
      case 'ready':
        this.emitStatus({ asrReady: true, provider: msg.provider, asrModel: msg.model });
        this.maybeStartListening();
        break;
      case 'progress':
        this.asrProgress = msg.progress;
        this.emitStatus({});
        break;
      case 'result':
        if (msg.isPartial || !msg.text) return;
        this.cb.onTranscript({ text: msg.text, reason: msg.reason });
        this.transcript.append(msg.text);
        this.dispatchQuery(msg.text);
        break;
      case 'falling-behind':
        this.emitStatus({ fallingBehind: true, droppedCount: msg.dropped });
        break;
      case 'error':
        this.cb.onError(msg.message);
        break;
    }
  }

  private onRetrieval(msg: RetrievalOutbound): void {
    switch (msg.type) {
      case 'ready':
        this.embedProgress = 1;
        this.emitStatus({ retrievalReady: true, hasSemantic: msg.hasSemantic });
        break;
      case 'progress':
        this.embedProgress = msg.progress;
        this.emitStatus({});
        break;
      case 'results':
        this.cb.onResults(this.mergeResults(msg.hits), {
          rawTerms: msg.rawTerms,
          correctedTerms: msg.correctedTerms,
        });
        break;
      case 'error':
        this.cb.onError(msg.message);
        break;
    }
  }

  private dispatchQuery(text: string): void {
    if (!this.retrievalWorker) return;
    const query: RetrievalInbound = {
      type: 'query',
      id: this.queryId++,
      text,
      transcriptWindow: this.transcript.window,
      excludeChunkIds: [...this.shownIds],
    };
    this.retrievalWorker.postMessage(query);
  }

  /** Merge fresh hits to the front, keeping the panel de-duplicated and bounded. */
  private mergeResults(hits: SearchHit[]): SearchHit[] {
    const maxDisplayed = Math.max(this.config.retrieval.topK, 6);
    const fresh = hits.filter((h) => !this.shownIds.has(h.chunk.id));
    this.displayed = [...fresh, ...this.displayed].slice(0, maxDisplayed);
    this.shownIds = new Set(this.displayed.map((h) => h.chunk.id));
    return this.displayed;
  }
}
