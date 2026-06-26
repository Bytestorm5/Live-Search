/**
 * ASR model registry + factory (architecture spec §5.3, §8.1).
 *
 * Moonshine (primary) scales compute with the actual speech duration, which is
 * what keeps per-utterance latency low; whisper-base.en is the alternative where
 * Whisper's ecosystem/accuracy is preferred.
 */
import type { AsrConfig } from '../config.ts';
import type { AsrModel, ExecutionProvider } from './types.ts';
import { TransformersAsrModel } from './transformersAsr.ts';

export const ASR_MODEL_REPOS: Record<AsrConfig['model'], string> = {
  'moonshine-tiny': 'onnx-community/moonshine-tiny-ONNX',
  'moonshine-base': 'onnx-community/moonshine-base-ONNX',
  'whisper-base.en': 'onnx-community/whisper-base.en',
};

/** Build an ASR model for the given logical name + execution provider. */
export function createAsrModel(model: AsrConfig['model'], provider: ExecutionProvider): AsrModel {
  // WebGPU runs full precision well; WASM benefits from 8-bit quantization.
  const dtype = provider === 'webgpu' ? 'fp32' : 'q8';
  return new TransformersAsrModel({ id: model, modelId: ASR_MODEL_REPOS[model], provider, dtype });
}
