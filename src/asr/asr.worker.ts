/// <reference lib="webworker" />
/**
 * ASR worker (architecture spec §5.3, §9). Owns the heaviest stage; only one
 * inference runs at a time, with utterances queued. A bounded backpressure queue
 * drops the oldest segments when the queue backs up (low-end CPU / WASM
 * fallback) so the most recent committed speech is prioritized — stale lookups
 * are worthless (spec §9).
 */
import { BoundedQueue } from '../pipeline/backpressure.ts';
import { createAsrModel } from './models.ts';
import { selectProvider } from './provider.ts';
import type { AsrModel } from './types.ts';
import { configureTransformersEnv } from '../modelEnv.ts';
import type { AsrInbound, AsrOutbound, SegmentMessage } from '../pipeline/messages.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let model: AsrModel | null = null;
let queue: BoundedQueue<SegmentMessage> | null = null;
let processing = false;

function post(msg: AsrOutbound, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

async function drain(): Promise<void> {
  if (processing || !model || !queue) return;
  processing = true;
  try {
    while (queue && !queue.isEmpty) {
      const seg = queue.dequeue()!;
      try {
        const res = await model.transcribe(seg.audio);
        post({
          type: 'result',
          id: seg.id,
          text: res.text,
          tokens: res.tokens,
          isPartial: res.isPartial,
          reason: seg.reason,
        });
      } catch (err) {
        post({ type: 'error', message: `Transcription failed: ${String(err)}` });
      }
    }
  } finally {
    processing = false;
  }
}

ctx.onmessage = async (e: MessageEvent<AsrInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load': {
      try {
        await configureTransformersEnv(msg.modelEnv);
        const provider = await selectProvider(msg.preferredProvider);
        queue = new BoundedQueue<SegmentMessage>(msg.maxQueue);
        model = createAsrModel(msg.model, provider);
        await model.load((p) => post({ type: 'progress', file: p.file, progress: p.progress, status: p.status }));
        post({ type: 'ready', provider, model: model.id });
      } catch (err) {
        post({ type: 'error', message: `ASR load failed: ${String(err)}` });
      }
      break;
    }
    case 'segment': {
      if (!queue) return;
      const { dropped } = queue.enqueue(msg.segment);
      if (dropped.length > 0) post({ type: 'falling-behind', dropped: queue.droppedCount });
      void drain();
      break;
    }
    case 'reset': {
      queue?.clear();
      break;
    }
  }
};
