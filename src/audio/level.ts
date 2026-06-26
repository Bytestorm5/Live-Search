/**
 * Microphone level metering. The RMS of a frame gives a simple loudness value
 * used to drive the live mic meter (a visible "is the mic actually working?"
 * indicator) and as a diagnostic that capture frames are flowing.
 */

/** Root-mean-square amplitude of a frame, in [0, 1] for normalized audio. */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** Scale an RMS value to a 0..1 meter level (speech RMS is small, so apply gain). */
export function toMeterLevel(rmsValue: number, gain = 4): number {
  if (!(rmsValue > 0)) return 0;
  return Math.min(1, rmsValue * gain);
}
