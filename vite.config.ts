import { defineConfig } from 'vite';

export default defineConfig({
  // These ship their own wasm/worker assets and are only pulled in by the
  // OPTIONAL local semantic-search path; let Vite serve them as-is.
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
