/**
 * PCM/base64 helpers for streaming microphone audio to the OpenAI Realtime
 * Transcription API, which expects base64-encoded 16-bit little-endian PCM
 * (mono, 24 kHz). Pure and unit-tested.
 */

/** Convert normalized Float32 samples (-1..1) to signed 16-bit PCM. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Base64-encode raw bytes (chunked to avoid argument-length limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Base64-encode an Int16 PCM buffer as little-endian bytes. */
export function int16ToBase64(pcm: Int16Array): string {
  // Int16Array is already little-endian on all supported platforms; view bytes.
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return bytesToBase64(bytes);
}

/** Convenience: Float32 frame -> base64 PCM16 in one step. */
export function floatFrameToBase64(input: Float32Array): string {
  return int16ToBase64(floatTo16BitPCM(input));
}
