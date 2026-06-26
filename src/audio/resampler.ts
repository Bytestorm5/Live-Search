/**
 * Streaming linear resampler used to convert microphone audio (typically 44.1 or
 * 48 kHz from `getUserMedia`) down to the 16 kHz mono that the VAD and ASR
 * models expect (architecture spec §4, §5.1).
 *
 * It is "streaming" in that it carries fractional phase and the last input
 * sample across `process()` calls, so feeding audio in the AudioWorklet's small
 * 128-sample blocks produces exactly the same output as resampling the whole
 * stream at once. Linear interpolation is cheap and adequate for ASR features;
 * higher-order filtering is left as future work (spec §12).
 */
export class Resampler {
  /** Input samples consumed per output sample (inputRate / outputRate). */
  readonly ratio: number;

  /** Position of the next output sample, relative to the current block start. */
  private posInBlock = 0;
  /** Last sample of the previous block (virtual index -1). */
  private prev = 0;
  /** Whether {@link prev} holds a real sample yet. */
  private primed = false;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
  ) {
    if (!(inputRate > 0) || !(outputRate > 0)) {
      throw new Error(`Resampler: rates must be positive, got ${inputRate} -> ${outputRate}`);
    }
    this.ratio = inputRate / outputRate;
  }

  /** Resample one block, carrying phase into the next call. */
  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0);

    const out: number[] = [];
    const len = input.length;
    let pos = this.posInBlock;

    while (pos < len) {
      const i = Math.floor(pos);
      const frac = pos - i;
      // Left neighbour: previous block's last sample when we straddle the start.
      const left = i < 0 ? (this.primed ? this.prev : input[0]) : input[i];
      const rightIndex = i + 1;
      if (rightIndex >= len) {
        // The right neighbour lives in the next block; defer this output so the
        // boundary is interpolated correctly once more audio arrives.
        break;
      }
      const right = input[rightIndex];
      out.push(left + (right - left) * frac);
      pos += this.ratio;
    }

    // Shift the carried position into the next block's coordinate space.
    this.posInBlock = pos - len;
    this.prev = input[len - 1];
    this.primed = true;
    return Float32Array.from(out);
  }

  /** Forget carried phase (e.g. after a stop/start). */
  reset(): void {
    this.posInBlock = 0;
    this.prev = 0;
    this.primed = false;
  }
}
