import { describe, it, expect, vi } from 'vitest';
import { OpenAIRealtimeTranscriber } from '../../src/asr/openaiRealtime.ts';
import type { MinimalWebSocket } from '../../src/asr/openaiRealtime.ts';
import type { TranscriptionSettings } from '../../src/asr/realtimeEvents.ts';

const SETTINGS: TranscriptionSettings = {
  model: 'gpt-4o-mini-transcribe',
  language: 'en',
  sampleRate: 24000,
  serverVad: true,
  noiseReduction: 'near_field',
};

class FakeWS implements MinimalWebSocket {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeWS.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(null);
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.(null);
  }
}

function make(cb = {}) {
  FakeWS.instances.length = 0;
  const t = new OpenAIRealtimeTranscriber(
    { apiKey: 'sk-test', settings: SETTINGS, WebSocketImpl: FakeWS as never },
    cb,
  );
  t.connect();
  return { t, ws: FakeWS.instances[0] };
}

describe('OpenAIRealtimeTranscriber', () => {
  it('connects with the insecure-api-key subprotocol', () => {
    const { ws } = make();
    expect(ws.protocols).toEqual(['realtime', 'openai-insecure-api-key.sk-test']);
    expect(ws.url).toContain('intent=transcription');
  });

  it('sends session.update on open', () => {
    const onOpen = vi.fn();
    const { ws } = make({ onOpen });
    ws.open();
    expect(onOpen).toHaveBeenCalled();
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe('transcription_session.update');
    expect(sent.session.input_audio_transcription.model).toBe('gpt-4o-mini-transcribe');
  });

  it('routes transcript completions and deltas to callbacks', () => {
    const onFinal = vi.fn();
    const onDelta = vi.fn();
    const { ws } = make({ onFinal, onDelta });
    ws.open();
    ws.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'He' });
    ws.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'i', transcript: 'Hello' });
    expect(onDelta).toHaveBeenCalledWith('He', 'i');
    expect(onFinal).toHaveBeenCalledWith('Hello', 'i');
  });

  it('routes server VAD speech events', () => {
    const onSpeech = vi.fn();
    const { ws } = make({ onSpeech });
    ws.open();
    ws.emit({ type: 'input_audio_buffer.speech_started' });
    ws.emit({ type: 'input_audio_buffer.speech_stopped' });
    expect(onSpeech).toHaveBeenNthCalledWith(1, true);
    expect(onSpeech).toHaveBeenNthCalledWith(2, false);
  });

  it('reports server error events', () => {
    const onError = vi.fn();
    const { ws } = make({ onError });
    ws.open();
    ws.emit({ type: 'error', error: { message: 'invalid_api_key' } });
    expect(onError).toHaveBeenCalledWith('invalid_api_key');
  });

  it('sends audio only once open, as base64 append events', () => {
    const { t, ws } = make();
    t.sendFrame(Float32Array.from([0.5, -0.5])); // not open yet -> dropped
    expect(ws.sent).toHaveLength(0);
    ws.open(); // sends session.update (sent[0])
    t.sendFrame(Float32Array.from([0.5, -0.5]));
    expect(ws.sent).toHaveLength(2);
    const append = JSON.parse(ws.sent[1]);
    expect(append.type).toBe('input_audio_buffer.append');
    expect(typeof append.audio).toBe('string');
  });

  it('close() tears down and marks not open', () => {
    const onClose = vi.fn();
    const { t, ws } = make({ onClose });
    ws.open();
    expect(t.isOpen).toBe(true);
    t.close();
    expect(t.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });
});
