/// <reference lib="webworker" />
/**
 * Retrieval worker (architecture spec §4 steps 4–5, §5.4, §5.5, §9). Runs term
 * extraction, vocabulary-constrained correction, and hybrid (lexical + semantic)
 * retrieval — all in-browser, no query leaving the device. Runs separately from
 * ASR so search never stalls transcription (spec §9).
 */
import type { AppConfig } from '../config.ts';
import { extractCandidateTerms } from '../terms/extract.ts';
import { configureTransformersEnv } from '../modelEnv.ts';
import { RetrievalEngine } from './engine.ts';
import { MiniLmEmbedder } from './minilmEmbedder.ts';
import type { RetrievalInbound, RetrievalOutbound } from '../pipeline/messages.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let engine: RetrievalEngine | null = null;
let config: AppConfig | null = null;

function post(msg: RetrievalOutbound): void {
  ctx.postMessage(msg);
}

ctx.onmessage = async (e: MessageEvent<RetrievalInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'loadIndex': {
      try {
        config = msg.config;
        const opts: ConstructorParameters<typeof RetrievalEngine>[0] = {
          index: msg.index,
          config: msg.config,
        };
        if (msg.useSemantic) {
          await configureTransformersEnv(msg.modelEnv);
          opts.embedder = new MiniLmEmbedder(msg.provider);
        }
        engine = new RetrievalEngine(opts);
        await engine.init();
        post({ type: 'ready', hasSemantic: engine.hasSemantic, chunkCount: engine.chunkCount });
      } catch (err) {
        post({ type: 'error', message: `Index load failed: ${String(err)}` });
      }
      break;
    }
    case 'query': {
      if (!engine || !config) return;
      try {
        const rawTerms = extractCandidateTerms(msg.text);
        const correctedTerms = engine.correct(rawTerms);
        const hits = await engine.query({
          terms: correctedTerms,
          transcriptWindow: msg.transcriptWindow,
          k: config.retrieval.topK,
          excludeChunkIds: msg.excludeChunkIds,
        });
        post({ type: 'results', id: msg.id, hits, rawTerms, correctedTerms });
      } catch (err) {
        post({ type: 'error', message: `Query failed: ${String(err)}` });
      }
      break;
    }
  }
};
