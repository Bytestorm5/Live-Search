import { describe, it, expect } from 'vitest';
import {
  buildSessionUpdate,
  buildAudioAppend,
  parseRealtimeEvent,
  buildSubprotocols,
  type TranscriptionSettings,
} from '../../src/asr/realtimeEvents.ts';

const SETTINGS: TranscriptionSettings = {
  model: 'gpt-4o-mini-transcribe',
  language: 'en',
  sampleRate: 24000,
  serverVad: true,
  noiseReduction: 'near_field',
};

describe('buildSessionUpdate', () => {
  it('produces a session.update with the GA nested transcription schema', () => {
    const u = buildSessionUpdate(SETTINGS) as any;
    expect(u.type).toBe('session.update');
    expect(u.session.type).toBe('transcription');
    expect(u.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(u.session.audio.input.transcription).toEqual({ model: 'gpt-4o-mini-transcribe', language: 'en' });
    expect(u.session.audio.input.turn_detection).toEqual({ type: 'server_vad' });
    expect(u.session.audio.input.noise_reduction).toEqual({ type: 'near_field' });
  });

  it('omits language when blank, nulls turn_detection when serverVad off, drops noise reduction when none', () => {
    const u = buildSessionUpdate({ ...SETTINGS, language: '', serverVad: false, noiseReduction: 'none' }) as any;
    expect(u.session.audio.input.transcription.language).toBeUndefined();
    expect(u.session.audio.input.turn_detection).toBeNull();
    expect(u.session.audio.input.noise_reduction).toBeUndefined();
  });
});

describe('buildAudioAppend', () => {
  it('wraps base64 audio', () => {
    expect(buildAudioAppend('AAAB')).toEqual({ type: 'input_audio_buffer.append', audio: 'AAAB' });
  });
});

describe('parseRealtimeEvent', () => {
  it('parses transcript deltas and completions', () => {
    expect(
      parseRealtimeEvent({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'Hel' }),
    ).toEqual({ kind: 'delta', itemId: 'i1', text: 'Hel' });
    expect(
      parseRealtimeEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: 'Hello there' }),
    ).toEqual({ kind: 'final', itemId: 'i1', text: 'Hello there' });
  });

  it('parses speech start/stop and session events', () => {
    expect(parseRealtimeEvent({ type: 'input_audio_buffer.speech_started' })).toEqual({ kind: 'speech-start' });
    expect(parseRealtimeEvent({ type: 'input_audio_buffer.speech_stopped' })).toEqual({ kind: 'speech-stop' });
    expect(parseRealtimeEvent({ type: 'session.updated' })).toEqual({ kind: 'session' });
    expect(parseRealtimeEvent({ type: 'transcription_session.created' })).toEqual({ kind: 'session' });
    expect(parseRealtimeEvent({ type: 'transcription_session.updated' })).toEqual({ kind: 'session' });
  });

  it('parses error events and malformed JSON', () => {
    expect(parseRealtimeEvent({ type: 'error', error: { message: 'bad key' } })).toEqual({ kind: 'error', message: 'bad key' });
    expect(parseRealtimeEvent('{not json').kind).toBe('error');
  });

  it('accepts JSON strings and falls through to other', () => {
    expect(parseRealtimeEvent(JSON.stringify({ type: 'rate_limits.updated' }))).toEqual({ kind: 'other', type: 'rate_limits.updated' });
  });
});

describe('buildSubprotocols', () => {
  it('includes the insecure api key and optional org/project', () => {
    expect(buildSubprotocols('sk-abc')).toEqual(['realtime', 'openai-insecure-api-key.sk-abc']);
    expect(buildSubprotocols('sk-abc', 'org_1', 'proj_2')).toEqual([
      'realtime',
      'openai-insecure-api-key.sk-abc',
      'openai-organization.org_1',
      'openai-project.proj_2',
    ]);
  });
});
