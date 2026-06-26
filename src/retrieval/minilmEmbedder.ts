/**
 * MiniLM-class sentence embedder via Transformers.js (architecture spec §5.5,
 * §8.1 "~25 MB"). Implements the {@link EmbeddingModel} contract; produces
 * mean-pooled, L2-normalized sentence vectors.
 */
import type { EmbeddingModel } from './embedding.ts';

type Device = 'webgpu' | 'wasm';

type FeaturePipe = (
  texts: string[],
  options?: Record<string, unknown>,
) => Promise<{ tolist: () => number[][] }>;

export const MINILM_REPO = 'Xenova/all-MiniLM-L6-v2';

export class MiniLmEmbedder implements EmbeddingModel {
  readonly id = MINILM_REPO;
  readonly dim = 384;
  private pipe: FeaturePipe | null = null;
  private readonly provider: Device;

  constructor(provider: Device = 'wasm') {
    this.provider = provider;
  }

  async load(onProgress?: (p: { progress: number }) => void): Promise<void> {
    if (this.pipe) return;
    const { pipeline } = await import('@huggingface/transformers');
    // Loose options object so we don't have to satisfy the package's exact
    // (and unstable) option/callback types.
    const options: Record<string, unknown> = {
      device: this.provider,
      progress_callback: (info: { progress?: number }) => onProgress?.({ progress: (info.progress ?? 0) / 100 }),
    };
    const pipe = await pipeline('feature-extraction', MINILM_REPO, options);
    this.pipe = pipe as unknown as FeaturePipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.pipe) await this.load();
    const out = await this.pipe!(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  }
}
