/**
 * Pure encode/decode for the OpenAI Realtime Transcription protocol
 * (https://developers.openai.com/api/docs/guides/realtime-transcription).
 *
 * Kept free of any WebSocket so the protocol mapping is unit-testable; the
 * client in {@link ./openaiRealtime.ts} just moves bytes.
 */

export type TranscriptionModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
export type NoiseReduction = 'near_field' | 'far_field' | 'none';

export interface TranscriptionSettings {
  model: TranscriptionModel;
  /** ISO language hint, e.g. "en". Empty to let the model auto-detect. */
  language: string;
  /** Sample rate of the PCM we send (Hz). */
  sampleRate: number;
  /** Use server-side VAD turn detection (recommended). */
  serverVad: boolean;
  noiseReduction: NoiseReduction;
}

/**
 * Build the `transcription_session.update` payload that configures the session.
 *
 * This targets the `?intent=transcription` endpoint, which uses the FLAT schema:
 * `input_audio_format` (a string; "pcm16" implies 24 kHz mono LE),
 * `input_audio_transcription`, `turn_detection`, and `input_audio_noise_reduction`
 * — NOT the GA `session.type: "transcription"` shape nested under `audio.input`,
 * which this endpoint silently ignores (resulting in no transcripts).
 */
export function buildSessionUpdate(s: TranscriptionSettings): object {
  const session: Record<string, unknown> = {
    input_audio_format: 'pcm16',
    input_audio_transcription: {
      model: s.model,
      ...(s.language ? { language: s.language } : {}),
    },
    turn_detection: s.serverVad ? { type: 'server_vad' } : null,
  };
  if (s.noiseReduction !== 'none') {
    session.input_audio_noise_reduction = { type: s.noiseReduction };
  }
  return { type: 'transcription_session.update', session };
}

/** Build an audio append event from base64-encoded PCM16. */
export function buildAudioAppend(base64Pcm: string): object {
  return { type: 'input_audio_buffer.append', audio: base64Pcm };
}

export type RealtimeEvent =
  | { kind: 'delta'; itemId: string; text: string }
  | { kind: 'final'; itemId: string; text: string }
  | { kind: 'speech-start' }
  | { kind: 'speech-stop' }
  | { kind: 'session' }
  | { kind: 'error'; message: string }
  | { kind: 'other'; type: string };

/** Parse a raw server message (JSON string or object) into a typed event. */
export function parseRealtimeEvent(data: string | object): RealtimeEvent {
  let msg: Record<string, unknown>;
  try {
    msg = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  } catch {
    return { kind: 'error', message: 'Malformed server event' };
  }
  const type = String(msg.type ?? '');
  switch (type) {
    case 'conversation.item.input_audio_transcription.delta':
      return { kind: 'delta', itemId: String(msg.item_id ?? ''), text: String(msg.delta ?? '') };
    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'final', itemId: String(msg.item_id ?? ''), text: String(msg.transcript ?? '') };
    case 'input_audio_buffer.speech_started':
      return { kind: 'speech-start' };
    case 'input_audio_buffer.speech_stopped':
      return { kind: 'speech-stop' };
    case 'session.created':
    case 'session.updated':
    case 'transcription_session.created':
    case 'transcription_session.updated':
      return { kind: 'session' };
    case 'error': {
      const err = msg.error as { message?: string } | undefined;
      return { kind: 'error', message: err?.message ?? 'Unknown transcription error' };
    }
    default:
      return { kind: 'other', type };
  }
}

/** Build the WebSocket subprotocols used for browser auth (user-supplied key). */
export function buildSubprotocols(apiKey: string, organization?: string, project?: string): string[] {
  const protocols = ['realtime', `openai-insecure-api-key.${apiKey}`];
  if (organization) protocols.push(`openai-organization.${organization}`);
  if (project) protocols.push(`openai-project.${project}`);
  return protocols;
}

export const REALTIME_TRANSCRIPTION_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
