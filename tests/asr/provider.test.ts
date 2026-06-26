import { describe, it, expect } from 'vitest';
import { hasWebGpuObject, probeWebGpu, selectProvider } from '../../src/asr/provider.ts';

describe('provider selection', () => {
  it('detects presence of a WebGPU object', () => {
    expect(hasWebGpuObject({ gpu: {} })).toBe(true);
    expect(hasWebGpuObject({})).toBe(false);
  });

  it('probes for a real adapter', async () => {
    expect(await probeWebGpu({ gpu: { requestAdapter: async () => ({}) } })).toBe(true);
    expect(await probeWebGpu({ gpu: { requestAdapter: async () => null } })).toBe(false);
    expect(await probeWebGpu({})).toBe(false);
  });

  it('returns wasm when an adapter request throws', async () => {
    expect(await probeWebGpu({ gpu: { requestAdapter: async () => { throw new Error('no'); } } })).toBe(false);
  });

  it('honors an explicit wasm preference without probing', async () => {
    let probed = false;
    const nav = { gpu: { requestAdapter: async () => { probed = true; return {}; } } };
    expect(await selectProvider('wasm', nav)).toBe('wasm');
    expect(probed).toBe(false);
  });

  it('selects webgpu when preferred and available, else falls back to wasm', async () => {
    expect(await selectProvider('webgpu', { gpu: { requestAdapter: async () => ({}) } })).toBe('webgpu');
    expect(await selectProvider('webgpu', {})).toBe('wasm');
  });
});
