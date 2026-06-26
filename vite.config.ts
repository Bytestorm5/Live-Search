import { defineConfig } from 'vite';
import type { Connect, PluginOption } from 'vite';
import type { ServerResponse } from 'node:http';

/**
 * SharedArrayBuffer (used for the lock-free audio ring buffer) requires the page
 * to be *cross-origin isolated*. That in turn requires these two response
 * headers (see architecture spec §11). This plugin sets them on both the dev
 * server and the preview server so local development matches production.
 */
function crossOriginIsolation(): PluginOption {
  const setHeaders = (_req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  };
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use(setHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(setHeaders);
    },
  };
}

export default defineConfig({
  plugins: [crossOriginIsolation()],
  // ES module workers so `new Worker(new URL(...), { type: 'module' })` works.
  worker: { format: 'es' },
  // These ship their own wasm/worker assets; let Vite serve them as-is instead
  // of pre-bundling, which would mangle the wasm/worker resolution.
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
