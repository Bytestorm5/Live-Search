/**
 * OpenAI Realtime Transcription client (architecture spec §5.3, revised).
 *
 * Streams 24 kHz mono PCM to the Realtime API over a WebSocket and surfaces
 * transcription deltas/completions plus server-VAD speech events. Audio is sent
 * to OpenAI for transcription; documentation retrieval still runs locally.
 *
 * Browser auth uses the documented (insecure) subprotocol that carries a
 * user-supplied API key — no backend required for a static SPA. The WebSocket
 * implementation is injectable so the protocol wiring is unit-testable.
 */
import { floatFrameToBase64 } from './pcm.ts';
import {
  REALTIME_TRANSCRIPTION_URL,
  buildAudioAppend,
  buildSessionUpdate,
  buildSubprotocols,
  parseRealtimeEvent,
} from './realtimeEvents.ts';
import type { TranscriptionSettings } from './realtimeEvents.ts';

/** The minimal WebSocket surface we use (real or fake). */
export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => MinimalWebSocket;

const OPEN = 1;

export interface OpenAIRealtimeOptions {
  apiKey: string;
  settings: TranscriptionSettings;
  organization?: string;
  project?: string;
  /** Override the endpoint (tests / proxies). */
  url?: string;
  /** Override the WebSocket constructor (tests). */
  WebSocketImpl?: WebSocketCtor;
}

export interface OpenAIRealtimeCallbacks {
  onOpen?(): void;
  onSessionReady?(): void;
  onDelta?(text: string, itemId: string): void;
  onFinal?(text: string, itemId: string): void;
  onSpeech?(active: boolean): void;
  onError?(message: string): void;
  onClose?(): void;
}

export class OpenAIRealtimeTranscriber {
  private ws: MinimalWebSocket | null = null;
  private opened = false;

  constructor(
    private readonly opts: OpenAIRealtimeOptions,
    private readonly cb: OpenAIRealtimeCallbacks = {},
  ) {}

  connect(): void {
    const Impl = this.opts.WebSocketImpl ?? (WebSocket as unknown as WebSocketCtor);
    const url = this.opts.url ?? REALTIME_TRANSCRIPTION_URL;
    const protocols = buildSubprotocols(this.opts.apiKey, this.opts.organization, this.opts.project);
    const ws = new Impl(url, protocols);
    this.ws = ws;

    ws.onopen = () => {
      this.opened = true;
      ws.send(JSON.stringify(buildSessionUpdate(this.opts.settings)));
      this.cb.onOpen?.();
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => this.cb.onError?.('WebSocket error connecting to OpenAI Realtime');
    ws.onclose = () => {
      this.opened = false;
      this.cb.onClose?.();
    };
  }

  private handle(data: unknown): void {
    const ev = parseRealtimeEvent(data as string);
    switch (ev.kind) {
      case 'delta':
        this.cb.onDelta?.(ev.text, ev.itemId);
        break;
      case 'final':
        this.cb.onFinal?.(ev.text, ev.itemId);
        break;
      case 'speech-start':
        this.cb.onSpeech?.(true);
        break;
      case 'speech-stop':
        this.cb.onSpeech?.(false);
        break;
      case 'session':
        this.cb.onSessionReady?.();
        break;
      case 'error':
        this.cb.onError?.(ev.message);
        break;
      case 'other':
        break;
    }
  }

  get isOpen(): boolean {
    return this.opened && this.ws?.readyState === OPEN;
  }

  /**
   * Send one Float32 frame (already at the configured sample rate). Returns true
   * if it was actually sent (socket open and frame non-empty).
   */
  sendFrame(frame: Float32Array): boolean {
    if (!this.isOpen || frame.length === 0) return false;
    this.ws!.send(JSON.stringify(buildAudioAppend(floatFrameToBase64(frame))));
    return true;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.opened = false;
  }
}
