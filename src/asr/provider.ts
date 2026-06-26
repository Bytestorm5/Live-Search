/**
 * Execution-provider selection (architecture spec §5.3, §10, §11).
 *
 * On startup the app probes `navigator.gpu`. If WebGPU is available it uses the
 * WebGPU backend; otherwise it falls back to WASM and the UI warns that latency
 * will be substantially higher. Support is detected at runtime, never assumed
 * (spec §11).
 */
import type { ExecutionProvider } from './types.ts';

export interface GpuLike {
  gpu?: { requestAdapter?: () => Promise<unknown> } | unknown;
}

/** The ambient `navigator` viewed structurally (lib.dom omits WebGPU types). */
const defaultNav = (): GpuLike =>
  typeof navigator !== 'undefined' ? (navigator as unknown as GpuLike) : {};

/** Synchronous, cheap check: is a WebGPU object even present? */
export function hasWebGpuObject(nav: GpuLike = defaultNav()): boolean {
  return !!nav && 'gpu' in nav && !!(nav as { gpu?: unknown }).gpu;
}

/**
 * Definitive check: can we actually acquire a GPU adapter? This is the real test
 * — some browsers expose `navigator.gpu` but fail to return an adapter.
 */
export async function probeWebGpu(nav: GpuLike = defaultNav()): Promise<boolean> {
  const gpu = (nav as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/** Resolve the provider to use, honoring an operator preference for WASM. */
export async function selectProvider(
  preferred: ExecutionProvider,
  nav: GpuLike = defaultNav(),
): Promise<ExecutionProvider> {
  if (preferred === 'wasm') return 'wasm';
  return (await probeWebGpu(nav)) ? 'webgpu' : 'wasm';
}
