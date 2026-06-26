/**
 * Application entry point (architecture spec §3, §11).
 *
 * Loads the prebuilt documentation index (if present), mounts the UI, and
 * registers the service worker that precaches assets + model weights for offline
 * use. All heavy work happens behind the UI in workers (spec §9).
 */
import './ui/styles.css';
import { App } from './ui/app.ts';
import type { CorpusIndex } from './retrieval/types.ts';

const INDEX_URL = '/corpus.index.json';

async function loadIndex(): Promise<CorpusIndex | null> {
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) return null;
    return (await res.json()) as CorpusIndex;
  } catch {
    return null;
  }
}

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Offline precaching is a progressive enhancement; ignore failures.
  }
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app mount point');

  if (!globalThis.crossOriginIsolated) {
    // SharedArrayBuffer (the audio ring buffer) needs COOP/COEP — the single
    // most common deployment gotcha (spec §11). Warn loudly but keep going so
    // the rest of the UI is still inspectable.
    console.warn(
      'Page is not cross-origin isolated; SharedArrayBuffer is unavailable. ' +
        'Serve with Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp (see public/_headers).',
    );
  }

  const index = await loadIndex();
  const app = new App({ index });
  app.mount(container);
  // Only register the offline cache in production builds. In dev a service
  // worker would serve stale bundles/workers across reloads, which masks code
  // changes (and made an earlier model-loading fix appear not to take effect).
  if (import.meta.env.PROD) void registerServiceWorker();
}

void main();
