/**
 * Minimal static file server used by the e2e tests. It deliberately mimics a
 * real static host (Netlify/CF Pages/`vite preview`):
 *   - sends the cross-origin isolation headers required for SharedArrayBuffer,
 *   - sends the privacy CSP,
 *   - and serves index.html as an SPA fallback for any path that doesn't map to
 *     a file. That SPA fallback is exactly what turned a missing model file into
 *     an HTML response and broke JSON.parse — so this server reproduces the bug.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function startStaticServer(root, port = 0) {
  const server = createServer(async (req, res) => {
    const isolation = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);

    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = normalize(join(root, pathname));

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) throw new Error('dir');
      const body = await readFile(filePath);
      res.setHeader('Content-Type', TYPES[extname(filePath)] ?? 'application/octet-stream');
      res.statusCode = 200;
      res.end(body);
    } catch {
      // SPA fallback: serve index.html for anything not found (HTTP 200).
      const body = await readFile(join(root, 'index.html'));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.statusCode = 200;
      res.end(body);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: actualPort, url: `http://localhost:${actualPort}` });
    });
  });
}

// Allow running standalone (used by playwright.config webServer).
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? 'dist';
  const port = Number(process.env.PORT ?? 4178);
  startStaticServer(root, port).then(({ url }) => console.log(`static server: ${url}`));
}
