/**
 * Model-asset environment (architecture spec §7, §8, §11).
 *
 * Two supported postures, both spec-compliant (§7.1 allows `connect-src` limited
 * to `'self'` OR only the model origin):
 *
 *  - DEFAULT — fetch model weights from the Hugging Face CDN on first load, then
 *    the service worker caches them for offline use (spec §8.1, §11). The CSP
 *    allows only the HF model origin for `connect-src`.
 *  - STRICT  — set `VITE_ALLOW_REMOTE_MODELS=false` and self-host weights under
 *    `/models/`; tighten the CSP `connect-src` to `'self'` for an air-gapped,
 *    highest-assurance deployment (spec §7.2).
 *
 * The ONNX Runtime WASM is bundled by Vite as a same-origin asset, so its path
 * needs no override (leaving `ortWasmPath` empty lets the bundler resolve it).
 */
import type { ModelEnv } from './pipeline/messages.ts';

const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const allowRemoteModels = (env.VITE_ALLOW_REMOTE_MODELS ?? 'true') !== 'false';

export const MODEL_ENV: ModelEnv = {
  allowRemoteModels,
  localModelPath: '/models/',
  // Empty => let the bundler-resolved (same-origin) ORT WASM be used.
  ortWasmPath: '',
};

/** URL of the self-hosted Silero VAD model (used in STRICT mode). */
export const SILERO_VAD_URL = `${MODEL_ENV.localModelPath}silero_vad.onnx`;

/**
 * Apply the Transformers.js global environment. Called inside any worker that
 * loads a Transformers.js model. Uses dynamic typing because the env shape is
 * not part of the package's stable public types.
 */
export async function configureTransformersEnv(modelEnv: ModelEnv): Promise<void> {
  const { env: hf } = await import('@huggingface/transformers');
  const e = hf as unknown as {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    backends?: { onnx?: { wasm?: { wasmPaths?: string } } };
  };
  e.allowRemoteModels = modelEnv.allowRemoteModels;
  e.allowLocalModels = true;
  e.localModelPath = modelEnv.localModelPath;
  const wasm = e.backends?.onnx?.wasm;
  if (wasm && modelEnv.ortWasmPath) wasm.wasmPaths = modelEnv.ortWasmPath;
}
