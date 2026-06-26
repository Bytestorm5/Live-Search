/**
 * Embedding-model contract for semantic retrieval (architecture spec §5.5).
 *
 * Concrete implementations (a MiniLM-class sentence encoder via Transformers.js)
 * live in the integration layer; the engine and ingest depend only on this
 * interface, so tests can supply a deterministic fake.
 */
import type { DocChunk, EmbeddingsData } from './types.ts';

export interface EmbeddingModel {
  /** Identifier; must match between ingest and query time. */
  readonly id: string;
  /** Output dimensionality. */
  readonly dim: number;
  /** Optional one-time weight load. */
  load?(onProgress?: (p: { progress: number }) => void): Promise<void>;
  /** Embed a batch of texts into vectors (one per text). */
  embed(texts: string[]): Promise<number[][]>;
}

/** Embed a single text. */
export async function embedOne(model: EmbeddingModel, text: string): Promise<number[]> {
  const [v] = await model.embed([text]);
  return v;
}

/** Embed every chunk, producing serializable {@link EmbeddingsData}. */
export async function embedChunks(
  chunks: DocChunk[],
  model: EmbeddingModel,
  batchSize = 32,
): Promise<EmbeddingsData> {
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize).map((c) => c.text);
    const embedded = await model.embed(batch);
    vectors.push(...embedded);
  }
  return { dim: model.dim, vectors, modelId: model.id };
}
