/**
 * Voice-activity segmenter (architecture spec §5.2).
 *
 * This is the *pure logic* of the VAD stage: it consumes a stream of per-frame
 * speech probabilities (produced upstream by the Silero VAD model) together with
 * the matching audio frames, and emits discrete *utterance segments* — a
 * contiguous run of speech bracketed by silence (spec §4 step 2). Keeping the
 * model out of this class makes the segmentation behaviour deterministic and
 * unit-testable.
 *
 * Why VAD is mandatory (spec §5.2): it stops the expensive ASR model from
 * running on silence, defines clean utterance boundaries for low-latency
 * commits, and bounds compute on a continuously open mic.
 */

export interface SegmenterOptions {
  sampleRate: number;
  /** Samples per frame (matches the upstream VAD window). */
  frameSamples: number;
  /** Probability at/above which an idle frame is treated as speech onset. */
  speechThreshold: number;
  /** While speaking, a frame below this counts as silence (hysteresis). */
  silenceThreshold: number;
  /** Trailing silence that ends an utterance, ms (spec default 400). */
  endOfUtteranceSilenceMs: number;
  /** Minimum speech content to accept an utterance, ms (rejects coughs). */
  minUtteranceMs: number;
  /** Force an incremental cut beyond this length, ms (spec default 15000). */
  maxUtteranceMs: number;
  /** Pre-speech audio retained so onsets aren't clipped, ms. */
  preSpeechPaddingMs: number;
}

/** Why a segment was committed. */
export type SegmentReason = 'silence' | 'maxLength' | 'flush';

/** A committed utterance ready for transcription (spec §4 step 2 -> step 3). */
export interface UtteranceSegment {
  /** 16 kHz mono audio: pre-speech padding + speech + trailing silence. */
  audio: Float32Array;
  /** Absolute sample index (since stream start / last reset) of audio[0]. */
  startSample: number;
  /** Absolute sample index one past the last sample. */
  endSample: number;
  /** Duration of {@link audio} in milliseconds. */
  durationMs: number;
  reason: SegmentReason;
  /** True for a complete utterance; false for a forced mid-speech cut. */
  isFinal: boolean;
}

type State = 'idle' | 'speaking';

export class VadSegmenter {
  private readonly opts: SegmenterOptions;
  private readonly endSilenceSamples: number;
  private readonly minSamples: number;
  private readonly maxSamples: number;
  private readonly paddingSamples: number;
  private readonly maxPreFrames: number;

  private _state: State = 'idle';
  private absSamples = 0;

  // Rolling pre-speech buffer (only used while idle).
  private preChunks: Float32Array[] = [];

  // Current utterance accumulation (only used while speaking).
  private segChunks: Float32Array[] = [];
  private segTotal = 0;
  private segStartSample = 0;
  private speechSamples = 0;
  private silenceRun = 0;

  constructor(opts: SegmenterOptions) {
    this.opts = opts;
    const perMs = opts.sampleRate / 1000;
    this.endSilenceSamples = Math.round(opts.endOfUtteranceSilenceMs * perMs);
    this.minSamples = Math.round(opts.minUtteranceMs * perMs);
    this.maxSamples = Math.round(opts.maxUtteranceMs * perMs);
    this.paddingSamples = Math.round(opts.preSpeechPaddingMs * perMs);
    this.maxPreFrames = Math.ceil(this.paddingSamples / opts.frameSamples) || 0;
  }

  get state(): State {
    return this._state;
  }

  /**
   * Feed one frame and its speech probability. Returns a committed segment if
   * this frame closed one (end-of-utterance silence, or a forced max-length
   * cut), otherwise null.
   */
  accept(prob: number, frame: Float32Array): UtteranceSegment | null {
    const frameStart = this.absSamples;
    this.absSamples += frame.length;

    if (this._state === 'idle') {
      if (prob >= this.opts.speechThreshold) {
        this.startUtterance(frameStart, frame);
        return this.checkMaxLength(frameStart, frame.length);
      }
      this.pushPre(frame);
      return null;
    }

    // speaking
    const isSilence = prob < this.opts.silenceThreshold;
    this.segChunks.push(frame);
    this.segTotal += frame.length;
    if (isSilence) {
      this.silenceRun += frame.length;
    } else {
      this.speechSamples += frame.length;
      this.silenceRun = 0;
    }

    const maxCut = this.checkMaxLength(frameStart, frame.length);
    if (maxCut) return maxCut;

    if (this.silenceRun >= this.endSilenceSamples) {
      return this.endUtterance('silence');
    }
    return null;
  }

  /** Commit any in-progress utterance (e.g. on stop). */
  flush(): UtteranceSegment | null {
    if (this._state !== 'speaking') return null;
    return this.endUtterance('flush');
  }

  /** Clear all state and restart sample positions from 0. */
  reset(): void {
    this._state = 'idle';
    this.absSamples = 0;
    this.preChunks = [];
    this.segChunks = [];
    this.segTotal = 0;
    this.segStartSample = 0;
    this.speechSamples = 0;
    this.silenceRun = 0;
  }

  // --- internals ---

  private pushPre(frame: Float32Array): void {
    if (this.maxPreFrames === 0) return;
    this.preChunks.push(frame);
    if (this.preChunks.length > this.maxPreFrames) this.preChunks.shift();
  }

  private startUtterance(frameStart: number, onset: Float32Array): void {
    const padding = this.collectPadding();
    this.segChunks = [];
    this.segTotal = 0;
    if (padding.length > 0) {
      this.segChunks.push(padding);
      this.segTotal += padding.length;
    }
    this.segStartSample = frameStart - padding.length;
    this.segChunks.push(onset);
    this.segTotal += onset.length;
    this.speechSamples = onset.length;
    this.silenceRun = 0;
    this._state = 'speaking';
    this.preChunks = [];
  }

  /** The tail (up to paddingSamples) of the rolling pre-speech buffer. */
  private collectPadding(): Float32Array {
    if (this.paddingSamples === 0 || this.preChunks.length === 0) return new Float32Array(0);
    const all = concat(this.preChunks);
    const start = Math.max(0, all.length - this.paddingSamples);
    return all.subarray(start);
  }

  /** Emit and continue if the running segment hit the max length. */
  private checkMaxLength(frameStart: number, frameLen: number): UtteranceSegment | null {
    if (this.segTotal < this.maxSamples) return null;
    const seg = this.buildSegment('maxLength', false);
    // Begin a fresh continuation segment at the next sample; stay speaking so a
    // long monologue keeps producing incremental output (spec §5.2, §10).
    this.segChunks = [];
    this.segTotal = 0;
    this.speechSamples = 0;
    this.silenceRun = 0;
    this.segStartSample = frameStart + frameLen;
    return seg;
  }

  private endUtterance(reason: SegmentReason): UtteranceSegment | null {
    const seg = this.speechSamples >= this.minSamples ? this.buildSegment(reason, reason !== 'maxLength') : null;
    this._state = 'idle';
    this.preChunks = [];
    this.segChunks = [];
    this.segTotal = 0;
    this.speechSamples = 0;
    this.silenceRun = 0;
    return seg;
  }

  private buildSegment(reason: SegmentReason, isFinal: boolean): UtteranceSegment {
    const audio = concat(this.segChunks);
    return {
      audio,
      startSample: this.segStartSample,
      endSample: this.segStartSample + audio.length,
      durationMs: (audio.length / this.opts.sampleRate) * 1000,
      reason,
      isFinal,
    };
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
