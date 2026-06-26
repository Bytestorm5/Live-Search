/**
 * Fetch the self-hosted model assets needed for STRICT / air-gapped mode
 * (architecture spec §7.2, §10, §11). Downloads the ~2 MB Silero VAD ONNX model
 * into `public/models/` so the VAD worker can load it from the same origin
 * (keeping the CSP `connect-src 'self'`).
 *
 *   node scripts/setup-assets.mjs
 *
 * The ASR (Moonshine/Whisper) and embedding (MiniLM) weights are fetched by
 * Transformers.js. In the default config they come from the Hugging Face CDN on
 * first load and are then cached by the service worker. To fully self-host them,
 * mirror their repos under public/models/<repo>/ and set
 * VITE_ALLOW_REMOTE_MODELS=false (see README §Privacy modes).
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';

const SILERO_URL =
  'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx';
const OUT = 'public/models/silero_vad.onnx';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await exists(OUT)) {
    console.log(`✓ ${OUT} already present.`);
    return;
  }
  await mkdir('public/models', { recursive: true });
  console.log(`Downloading Silero VAD → ${OUT} …`);
  const res = await fetch(SILERO_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(OUT, buf);
  console.log(`✓ Saved ${OUT} (${(buf.length / 1024).toFixed(0)} KiB).`);
}

main().catch((err) => {
  console.error('setup-assets failed:', err.message);
  console.error('You can also download Silero VAD manually and place it at', OUT);
  process.exit(1);
});
