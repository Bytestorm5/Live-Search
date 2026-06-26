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
 * Build the session-configuration payload for the `?intent=transcription`
 * endpoint (GA schema).
 *
 * Determined empirically from the server's own validation errors: the event type
 * must be `session.update` (it rejects `transcription_session.update`), and the
 * session body requires `session.type: "transcription"` with the audio config
 * nested under `session.audio.input` (`format`, `transcription`, `turn_detection`,
 * `noise_reduction`). "audio/pcm" at 24 kHz mono LE matches the PCM16 we stream.
 */
export function buildSessionUpdate(s: TranscriptionSettings): object {
  const input: Record<string, unknown> = {
    format: { type: 'audio/pcm', rate: s.sampleRate },
    transcription: {
      model: s.model,
      ...(s.language ? { language: s.language } : {}),
    },
    turn_detection: s.serverVad ? { type: 'server_vad' } : null,
  };
  if (s.noiseReduction !== 'none') {
    input.noise_reduction = { type: s.noiseReduction };
  }
  return { type: 'session.update', session: { type: 'transcription', audio: { input } } };
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
