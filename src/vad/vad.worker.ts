/// <reference lib="webworker" />
/**
 * VAD worker (architecture spec §5.2, §9). Reads native-rate audio from the ring
 * buffer, resamples to 16 kHz, runs the Silero model per frame, and feeds the
 * probabilities to the segmenter. Completed utterance segments are posted to the
 * ASR worker. Runs separately from ASR so a slow transcription never stalls
 * segmentation (spec §9).
 */
import { RingBuffer } from '../audio/ringBuffer.ts';
import { Resampler } from '../audio/resampler.ts';
import { VadSegmenter } from './segmenter.ts';
import type { UtteranceSegment } from './segmenter.ts';
import { SileroVad } from './sileroVad.ts';
import type { SegmentMessage, VadInbound, VadOutbound } from '../pipeline/messages.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let ring: RingBuffer | null = null;
let resampler: Resampler | null = null;
let segmenter: VadSegmenter | null = null;
let vad: SileroVad | null = null;
let frameSamples = 512;
let running = false;
// Annotated as the wide Float32Array so concat()'s return assigns cleanly.
let assembly: Float32Array = new Float32Array(0);
let segId = 0;
let lastSpeaking = false;

function post(msg: VadOutbound, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function emitSegment(seg: UtteranceSegment): void {
  const segment: SegmentMessage = {
    id: segId++,
    audio: seg.audio,
    startSample: seg.startSample,
    endSample: seg.endSample,
    durationMs: seg.durationMs,
    reason: seg.reason,
    isFinal: seg.isFinal,
  };
  post({ type: 'segment', segment }, [seg.audio.buffer]);
}

async function pump(): Promise<void> {
  const raw = new Float32Array(4096);
  while (running && ring && resampler && segmenter && vad) {
    const n = ring.read(raw);
    if (n === 0) {
      await new Promise((r) => setTimeout(r, 10));
      continue;
    }
    const resampled = resampler.process(raw.subarray(0, n));
    if (resampled.length) assembly = concat(assembly, resampled);

    while (assembly.length >= frameSamples) {
      const frame = assembly.slice(0, frameSamples);
      assembly = assembly.slice(frameSamples);
      let prob = 0;
      try {
        prob = await vad.process(frame);
      } catch (err) {
        post({ type: 'error', message: `VAD inference failed: ${String(err)}` });
        running = false;
        return;
      }
      const seg = segmenter.accept(prob, frame);
      if (seg) emitSegment(seg);
      const speaking = segmenter.state === 'speaking';
      if (speaking !== lastSpeaking) {
        lastSpeaking = speaking;
        post({ type: 'state', speaking });
      }
    }
  }
}

ctx.onmessage = async (e: MessageEvent<VadInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      try {
        ring = new RingBuffer(msg.sab);
        resampler = new Resampler(msg.inputSampleRate, msg.targetSampleRate);
        frameSamples = msg.vad.frameSamples;
        segmenter = new VadSegmenter({ ...msg.vad, sampleRate: msg.targetSampleRate });
        vad = new SileroVad({
          modelUrl: msg.modelUrl,
          ortWasmPath: msg.ortBasePath,
          sampleRate: msg.targetSampleRate,
        });
        await vad.load();
        post({ type: 'ready' });
      } catch (err) {
        post({ type: 'error', message: `VAD init failed: ${String(err)}` });
      }
      break;
    }
    case 'start': {
      if (!running) {
        running = true;
        assembly = new Float32Array(0);
        void pump();
      }
      break;
    }
    case 'stop': {
      running = false;
      const seg = segmenter?.flush();
      if (seg) emitSegment(seg);
      break;
    }
  }
};
