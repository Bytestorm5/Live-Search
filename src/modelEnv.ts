/**
 * Transformers.js environment for the OPTIONAL local semantic embedder
 * (MiniLM, ~25 MB). Disabled by default — the app needs no client model
 * downloads unless semantic search is turned on. Weights load from the model
 * CDN; ONNX Runtime WASM is bundled by Vite as a same-origin asset.
 */
export interface ModelEnv {
  allowRemoteModels: boolean;
  localModelPath: string;
}

const env = (import.meta as { env?: Record<string, string> }).env ?? {};

export const MODEL_ENV: ModelEnv = {
  allowRemoteModels: (env.VITE_ALLOW_REMOTE_MODELS ?? 'true') !== 'false',
  localModelPath: '/models/',
};

/** Apply the Transformers.js global env (dynamic-typed; the shape isn't public). */
export async function configureTransformersEnv(modelEnv: ModelEnv = MODEL_ENV): Promise<void> {
  const { env: hf } = await import('@huggingface/transformers');
  const e = hf as unknown as {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
  };
  e.allowRemoteModels = modelEnv.allowRemoteModels;
  // Avoid same-origin /models/ probing (which a static host answers with
  // index.html) unless we're explicitly self-hosting weights.
  e.allowLocalModels = !modelEnv.allowRemoteModels;
  e.localModelPath = modelEnv.localModelPath;
}
