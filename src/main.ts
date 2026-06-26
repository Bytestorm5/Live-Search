/**
 * Application entry point. Loads the prebuilt documentation index (if present)
 * and mounts the UI. Transcription is provided by the OpenAI Realtime API
 * (configured with the user's API key in Settings); document retrieval runs
 * locally against the index.
 */
import './ui/styles.css';
import { App } from './ui/app.ts';
import type { CorpusIndex } from './retrieval/types.ts';

const INDEX_URL = '/corpus.index.json';

async function loadIndex(): Promise<CorpusIndex | null> {
  try {
    const res = await fetch(INDEX_URL);
    if (!res.ok) return null;
    const text = await res.text();
    // Guard against a static host's SPA fallback returning index.html.
    if (text.trimStart().startsWith('<')) return null;
    return JSON.parse(text) as CorpusIndex;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app mount point');
  const index = await loadIndex();
  new App({ index }).mount(container);
}

void main();
