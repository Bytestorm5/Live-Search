/**
 * Application entry point. Loads the prebuilt documentation index (if present)
 * and mounts the UI. Transcription is provided by the OpenAI Realtime API
 * (configured with the user's API key in Settings); document retrieval runs
 * locally against the index.
 */
import './ui/styles.css';
import { App } from './ui/app.ts';
import { loadCorpusIndex } from './retrieval/loadIndex.ts';

const INDEX_URL = '/corpus.index.ndjson';

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app mount point');
  const index = await loadCorpusIndex(INDEX_URL);
  new App({ index }).mount(container);
}

void main();
