/**
 * Pipeline orchestrator (architecture spec §3, §4, revised for OpenAI Realtime).
 *
 *   mic → AudioWorklet → resample(24 kHz) → PCM16 → OpenAI Realtime WS
 *        → committed transcript → term extraction + correction → local retrieval → UI
 *
 * Transcription (incl. VAD/segmentation) is done server-side by OpenAI; document
 * retrieval runs entirely on the main thread against the locally held index.
 * The only cross-utterance state is the rolling transcript window and the set of
 * chunks already on screen (de-duplication, spec §4 step 5).
 */
import type { AppConfig } from '../config.ts';
import { Resampler } from '../audio/resampler.ts';
import { startCapture } from '../audio/capture.ts';
import type { CaptureHandle } from '../audio/capture.ts';
import { rms, toMeterLevel } from '../audio/level.ts';
import { OpenAIRealtimeTranscriber } from '../asr/openaiRealtime.ts';
import type { TranscriptionSettings } from '../asr/realtimeEvents.ts';
import { RetrievalEngine } from '../retrieval/engine.ts';
import { extractCandidateTerms } from '../terms/extract.ts';
import { configureTransformersEnv } from '../modelEnv.ts';
import type { CorpusIndex, SearchHit } from '../retrieval/types.ts';
import { RollingTranscript } from './transcript.ts';

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'error';

export interface PipelineStatus {
  micActive: boolean;
  connection: ConnectionState;
  speaking: boolean;
  searchReady: boolean;
  hasSemantic: boolean;
  semanticLoading: boolean;
}

export interface ResultsInfo {
  rawTerms: string[];
  correctedTerms: string[];
}

export interface OrchestratorCallbacks {
  onStatus(status: PipelineStatus): void;
  onTranscript(entry: { text: string; isFinal: boolean }): void;
  onResults(hits: SearchHit[], info: ResultsInfo): void;
  /** Live mic level in [0, 1] for the meter (also confirms frames are flowing). */
  onMicLevel(level: number): void;
  onError(message: string): void;
}

export interface OrchestratorOptions {
  config: AppConfig;
  index: CorpusIndex | null;
  apiKey: string;
  organization?: string;
  project?: string;
  callbacks: OrchestratorCallbacks;
}

export class Orchestrator {
  private readonly config: AppConfig;
  private readonly index: CorpusIndex | null;
  private readonly apiKey: string;
  private readonly organization?: string;
  private readonly project?: string;
  private readonly cb: OrchestratorCallbacks;

  private capture: CaptureHandle | null = null;
  private resampler: Resampler | null = null;
  private transcriber: OpenAIRealtimeTranscriber | null = null;
  private engine: RetrievalEngine | null = null;

  private readonly transcript: RollingTranscript;
  private displayed: SearchHit[] = [];
  private shownIds = new Set<string>();
  private started = false;
  private audioSent = false;
  private audioWatchdog: ReturnType<typeof setTimeout> | null = null;

  private status: PipelineStatus = {
    micActive: false,
    connection: 'idle',
    speaking: false,
    searchReady: false,
    hasSemantic: false,
    semanticLoading: false,
  };

  constructor(opts: OrchestratorOptions) {
    this.config = opts.config;
    this.index = opts.index;
    this.apiKey = opts.apiKey;
    if (opts.organization) this.organization = opts.organization;
    if (opts.project) this.project = opts.project;
    this.cb = opts.callbacks;
    this.transcript = new RollingTranscript(opts.config.retrieval.transcriptWindowChars);
  }

  get hasRetrieval(): boolean {
    return this.index !== null;
  }

  private emitStatus(patch: Partial<PipelineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.cb.onStatus(this.status);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.audioSent = false;
    this.emitStatus({ connection: 'connecting' });

    // Build the retrieval index in the background (lexical is instant; semantic
    // optionally downloads MiniLM — spec §5.5, §10 graceful fallback).
    void this.buildEngine();

    try {
      this.capture = await startCapture((frame) => this.onFrame(frame), { source: this.config.audio.source });
      this.resampler = new Resampler(this.capture.sampleRate, this.config.audio.targetSampleRate);
      this.emitStatus({ micActive: true });

      const settings: TranscriptionSettings = {
        model: this.config.transcription.model,
        language: this.config.transcription.language,
        sampleRate: this.config.audio.targetSampleRate,
        serverVad: this.config.transcription.serverVad,
        noiseReduction: this.config.transcription.noiseReduction,
      };

      this.transcriber = new OpenAIRealtimeTranscriber(
        {
          apiKey: this.apiKey,
          settings,
          ...(this.organization ? { organization: this.organization } : {}),
          ...(this.project ? { project: this.project } : {}),
        },
        {
          onSessionReady: () => {
            this.emitStatus({ connection: 'live' });
            this.armAudioWatchdog();
          },
          onDelta: (text) => this.cb.onTranscript({ text, isFinal: false }),
          onFinal: (text) => void this.handleFinal(text),
          onSpeech: (active) => this.emitStatus({ speaking: active }),
          onError: (message) => {
            this.emitStatus({ connection: 'error' });
            this.cb.onError(message);
          },
          onClose: () => {
            if (this.started) this.emitStatus({ connection: 'idle' });
          },
        },
      );
      this.transcriber.connect();
    } catch (err) {
      this.emitStatus({ connection: 'error' });
      this.cb.onError(`Failed to start: ${String(err)}`);
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.audioWatchdog) {
      clearTimeout(this.audioWatchdog);
      this.audioWatchdog = null;
    }
    this.transcriber?.close();
    this.transcriber = null;
    await this.capture?.stop();
    this.capture = null;
    this.resampler = null;
    this.transcript.clear();
    this.displayed = [];
    this.shownIds.clear();
    this.cb.onMicLevel(0);
    this.emitStatus({ micActive: false, speaking: false, connection: 'idle' });
  }

  // --- internals ---

  private async buildEngine(): Promise<void> {
    if (!this.index) return;
    if (this.config.retrieval.semantic) {
      this.emitStatus({ semanticLoading: true });
      try {
        await configureTransformersEnv();
        const { MiniLmEmbedder } = await import('../retrieval/minilmEmbedder.ts');
        const engine = new RetrievalEngine({ index: this.index, config: this.config, embedder: new MiniLmEmbedder('wasm') });
        await engine.init();
        this.engine = engine;
      } catch (err) {
        // Graceful degradation (spec §10): fall back to lexical-only.
        console.warn('[retrieval] semantic disabled, using lexical only:', err);
        this.engine = new RetrievalEngine({ index: this.index, config: this.config });
        await this.engine.init();
      }
      this.emitStatus({ semanticLoading: false, hasSemantic: this.engine.hasSemantic, searchReady: true });
    } else {
      this.engine = new RetrievalEngine({ index: this.index, config: this.config });
      await this.engine.init();
      this.emitStatus({ hasSemantic: false, searchReady: true });
    }
  }

  private onFrame(frame: Float32Array): void {
    // Mic meter first — works even before the socket opens, so the user can see
    // the mic is live regardless of connection state.
    this.cb.onMicLevel(toMeterLevel(rms(frame)));
    if (!this.resampler || !this.transcriber) return;
    const resampled = this.resampler.process(frame);
    if (!resampled.length) return;
    if (this.transcriber.sendFrame(resampled) && !this.audioSent) {
      this.audioSent = true;
      if (this.audioWatchdog) {
        clearTimeout(this.audioWatchdog);
        this.audioWatchdog = null;
      }
    }
  }

  /** Warn if we go live but no microphone audio actually reaches the socket. */
  private armAudioWatchdog(): void {
    if (this.audioWatchdog) clearTimeout(this.audioWatchdog);
    this.audioWatchdog = setTimeout(() => {
      if (this.started && !this.audioSent) {
        this.cb.onError(
          'Connected to OpenAI, but no microphone audio is being sent. Check that the right mic is selected and not muted.',
        );
      }
    }, 5000);
  }

  private async handleFinal(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    this.cb.onTranscript({ text: clean, isFinal: true });
    this.transcript.append(clean);
    if (!this.engine) return;

    const rawTerms = extractCandidateTerms(clean);
    const correctedTerms = this.engine.correct(rawTerms);
    const hits = await this.engine.query({
      terms: correctedTerms,
      transcriptWindow: this.transcript.window,
      k: this.config.retrieval.topK,
      excludeChunkIds: [...this.shownIds],
    });
    this.cb.onResults(this.mergeResults(hits), { rawTerms, correctedTerms });
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
