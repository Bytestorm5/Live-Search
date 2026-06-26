# Live Search — Private Live Transcription & Documentation Lookup

Client-side, privacy-first live speech transcription that surfaces relevant
documentation **as you speak**. All speech recognition and retrieval run in the
browser — **no audio or transcript ever leaves the device**. After a one-time
model download it runs fully offline.

This is a complete implementation of the
[architecture specification](docs/architecture.md); section references like
“(spec §5.4)” throughout the code point back to it, and the
[spec→code map](#how-the-spec-maps-to-the-code) below shows where each part lives.

---

## Highlights

- **On-device only.** No inference backend. The privacy property is structural,
  not a policy promise: there is nowhere for audio to be sent (spec §7).
- **Low latency.** Documentation appears ~0.7–1.3 s after a phrase ends, within
  the ≤ 1.5 s target (spec §6).
- **Robust to ASR errors.** Vocabulary-constrained correction repairs
  mistranscribed domain terms against the corpus before querying (spec §5.4).
- **Hybrid retrieval.** BM25 lexical + MiniLM semantic vectors, fused with
  reciprocal rank fusion (spec §5.5).
- **Verifiable privacy.** A strict CSP (`connect-src 'self'`) makes exfiltration
  inspectably impossible in the strict configuration (spec §7.1).
- **Test-driven.** The latency- and correctness-critical core is covered by an
  extensive unit-test suite (`npm test`).

## The pipeline

```
mic → AudioWorklet → ring buffer → VAD worker → ASR worker → term extraction
      (capture)      (SharedArray)  (Silero)     (Moonshine)  + vocab correction
                                                                     │
                                                                     ▼
                                                 retrieval worker (BM25 + vectors)
                                                                     │
                                                                     ▼
                                                          UI (results + transcript)
```

Each heavy stage owns a Web Worker so the UI thread stays free and latency is
deterministic (spec §3, §9). The only state kept between utterances is a short
rolling transcript window.

---

## Quick start

```bash
npm install

# Build the documentation index from docs-corpus/ (sample docs are included):
npm run ingest

# Run the dev server (sets the COOP/COEP headers automatically):
npm run dev
```

Open the printed URL, click **Start listening**, and grant microphone access.
The ~2 MB Silero VAD model is bundled with the app (no setup step). On first run
the ASR/embedding model weights (~175 MB) download from the Hugging Face CDN and
are then cached for offline use. WebGPU is used when available, with an automatic
WASM fallback (a slower-latency warning is shown).

> **Browser support:** Chromium 113+ or recent Safari with WebGPU. Firefox
> generally needs a flag for WebGPU and will use the WASM fallback (spec §11).

---

## Feeding in your documentation

Your documentation is the corpus the app searches. There are two ways to provide
it; **the recommended path is the ingest CLI.**

### 1. Drop files in `docs-corpus/` and run the ingest CLI (recommended)

Put your docs in `docs-corpus/` (any nested folder structure works). Supported
formats:

| Format | Extension | Title comes from | Notes |
|---|---|---|---|
| Markdown | `.md`, `.markdown` | first `#` heading → filename | code spans/blocks are **kept** (that's where API symbols live) |
| Plain text | `.txt` | filename | |
| HTML | `.html`, `.htm` | `<title>` → `<h1>` → filename | tags/scripts stripped |
| JSON | `.json` | each doc's `title` | a single doc, an array, or `{ "docs": [...] }` |

The JSON shape (most control) is:

```json
{
  "docs": [
    {
      "id": "billing/refunds",
      "title": "Issuing refunds",
      "text": "Full plain-text body of the document …",
      "url": "https://docs.example.com/billing/refunds"
    }
  ]
}
```

`id` and `title` are optional for JSON (they default from the file path); `text`
is required; `url` is optional and, when present, makes the result card a link.

Then build the index:

```bash
npm run ingest                 # reads docs-corpus/, writes public/corpus.index.json
npm run ingest -- ./my-docs    # use a different source directory
npm run ingest -- --embed      # also precompute MiniLM embeddings at build time
npm run ingest -- --out public/corpus.index.json
```

`ingest` chunks the docs, builds the BM25 index, and extracts the known
vocabulary used for correction. With `--embed` it also precomputes semantic
embeddings (downloads MiniLM the first time); otherwise embeddings are computed
in-browser at load. The output `public/corpus.index.json` is what the app
fetches at startup.

> **Re-run `npm run ingest` whenever your docs change.** The generated index is a
> derived artifact and is git-ignored by default.

### 2. Ship a prebuilt `corpus.index.json`

If you build the index elsewhere (e.g. in CI), just place the resulting
`corpus.index.json` at the web root (`public/corpus.index.json`). The format is
defined by the `CorpusIndex` type in
[`src/retrieval/types.ts`](src/retrieval/types.ts). The app runs without an index
too (transcript-only mode) and shows a “no corpus loaded” status.

---

## Privacy modes

Both modes are spec-compliant — §7.1 permits `connect-src` limited to `'self'`
**or only the model origin**.

| | **Default** | **Strict / air-gapped** |
|---|---|---|
| ASR + embedding weights | Hugging Face CDN on first load, then SW-cached | self-hosted under `public/models/` |
| VAD (Silero) | bundled same-origin asset | bundled same-origin asset |
| `VITE_ALLOW_REMOTE_MODELS` | `true` | `false` |
| CSP `connect-src` | `'self'` + `*.huggingface.co` | `'self'` only |
| Audio/transcript egress | none (no code path sends them) | none |

To go strict: copy `.env.example` to `.env`, set `VITE_ALLOW_REMOTE_MODELS=false`,
mirror the ASR + MiniLM repos under `public/models/<repo>/` (Silero is already
bundled), and drop the `huggingface.co`/`hf.co` entries from the CSP in
`index.html` and `public/_headers`. When remote models are disabled,
Transformers.js loads from `/models/` only.

In **either** mode, audio and transcripts never leave the device: no code path
POSTs them, and the CSP only permits GETs to the model origin. You can confirm
zero outbound audio traffic in DevTools (spec §7.1).

---

## Deployment

Any static host works — there is no application server (spec §11). Two response
headers are **required** because the audio ring buffer uses `SharedArrayBuffer`,
which needs the page to be cross-origin isolated (the single most common
deployment gotcha, spec §11):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

[`public/_headers`](public/_headers) sets these (plus the CSP) for Netlify and
Cloudflare Pages. For other hosts, configure the equivalent headers. The dev/
preview servers set them via a Vite plugin ([`vite.config.ts`](vite.config.ts)).

```bash
npm run build      # type-checks then builds to dist/
npm run preview    # serve the production build locally (with COOP/COEP)
```

A service worker ([`public/sw.js`](public/sw.js)) precaches the app shell, model
weights, and ONNX runtime so the app works offline after first load.

---

## Testing

The privacy- and latency-critical logic is built test-first with
[Vitest](https://vitest.dev):

```bash
npm test            # run the suite once
npm run test:watch  # watch mode
npm run coverage    # coverage report
npm run typecheck   # tsc --noEmit (strict)
```

Pure logic (ring buffer, VAD segmenter, BM25, vectors, fusion, edit
distance/phonetics, correction, chunking, snippets, the hybrid engine,
backpressure, rolling transcript, provider selection, DOM render helpers) is
unit-tested. The browser/model glue (workers, AudioWorklet, model wrappers) is
validated by `tsc` and the production build, and kept thin so the tested core
carries the behavior.

### End-to-end (browser) tests

Some failures only happen in a real browser served by a real static host — e.g.
a model file resolving to the SPA `index.html` fallback and breaking
`JSON.parse`. Those are covered by a Playwright test that serves the build from a
SPA-fallback server and drives Chromium:

```bash
npm run test:e2e   # builds, then runs Playwright against the build
```

It needs a Chromium browser: either set `PLAYWRIGHT_CHROMIUM_PATH`, or run
`npx playwright install chromium`. `e2e/repro.spec.ts` specifically guards
against the model-loading regression described in Troubleshooting.

## Troubleshooting

**`Index load failed: SyntaxError: JSON.parse: unexpected character at line 1
column 1`** — a model file was fetched from the app's own origin and the static
host returned `index.html` (its SPA fallback) instead of the file, so JSON
parsing hit `<!doctype html>`. This is fixed (the app loads remote weights from
the model CDN in default mode and only reads `/models/` in strict mode), and
retrieval now degrades to lexical-only if the semantic model can't load at all.
If you still see it after updating:

- **Unregister a stale service worker.** Earlier builds registered the SW in dev,
  which can keep serving old bundles. In DevTools → Application → Service
  Workers, click *Unregister*, then hard-reload (the SW now registers in
  production builds only). Or run in a private window.
- **Restart the dev server** after pulling, so workers are rebuilt.

**The page won't start / `SharedArrayBuffer is not defined`** — the host isn't
sending the COOP/COEP headers; see [Deployment](#deployment). `npm run dev` and
`npm run preview` set them automatically.

---

## Project structure

```
src/
  audio/        ring buffer (SharedArrayBuffer), streaming resampler, mic capture
  vad/          segmenter state machine, Silero wrapper, VAD worker
  asr/          ASR contract, provider selection, Transformers.js backends, ASR worker
  terms/        phonetics, edit distance, extraction, vocabulary-constrained correction
  retrieval/    tokenizer, BM25, vector index, fusion, chunking, snippets, ingest,
                hybrid engine, MiniLM embedder, retrieval worker
  pipeline/     worker messages, backpressure queue, rolling transcript, orchestrator
  ui/           DOM helpers, result rendering, app controller, styles
  ingest/       pure doc loaders (markdown/html/json → text)
  config.ts     all tunables and defaults (spec §2, §6)
  modelEnv.ts   model-asset / privacy-mode configuration
scripts/        ingest CLI, asset setup
docs-corpus/    sample documentation (replace with your own)
public/         worklet, service worker, _headers, model assets, corpus index
tests/          mirrors src/
```

## Configuration

All tunables live in [`src/config.ts`](src/config.ts) (`DEFAULT_CONFIG`): VAD
thresholds and utterance bounds, ASR model + provider, correction distance/
similarity, retrieval `topK`/fusion/BM25/chunking parameters, and the
backpressure queue size. The UI exposes model, provider, VAD sensitivity, and
result count (spec §5.6).

## Model footprint (first load, then cached)

| Asset | Size |
|---|---|
| ASR (Moonshine base, WebGPU) | ~150 MB |
| Embedding (MiniLM) | ~25 MB |
| VAD (Silero) | ~2 MB |
| **Total** | **~175 MB** |

## How the spec maps to the code

| Spec section | Implementation |
|---|---|
| §4 Capture, §5.1 Audio | `src/audio/ringBuffer.ts`, `src/audio/resampler.ts`, `src/audio/capture.ts`, `public/worklets/capture-processor.js` |
| §5.2 Voice activity detection | `src/vad/segmenter.ts`, `src/vad/sileroVad.ts`, `src/vad/vad.worker.ts` |
| §5.3 Speech recognition | `src/asr/types.ts`, `src/asr/provider.ts`, `src/asr/transformersAsr.ts`, `src/asr/models.ts`, `src/asr/asr.worker.ts` |
| §5.4 Term extraction & correction | `src/terms/extract.ts`, `src/terms/phonetic.ts`, `src/terms/editDistance.ts`, `src/terms/vocabulary.ts`, `src/terms/correction.ts` |
| §5.5 Retrieval (lexical + semantic + fusion) | `src/retrieval/bm25.ts`, `src/retrieval/vectorIndex.ts`, `src/retrieval/fusion.ts`, `src/retrieval/chunk.ts`, `src/retrieval/engine.ts`, `src/retrieval/minilmEmbedder.ts`, `src/retrieval/retrieval.worker.ts` |
| §5.6 Presentation | `src/ui/render.ts`, `src/ui/app.ts`, `src/ui/styles.css` |
| §6 Latency budget, §3 rolling window | `src/pipeline/transcript.ts`, `src/config.ts` |
| §7 Privacy & verifiability | `index.html` CSP, `public/_headers`, `src/modelEnv.ts` |
| §9 Threading & backpressure | `src/pipeline/orchestrator.ts`, `src/pipeline/messages.ts`, `src/pipeline/backpressure.ts` |
| §10 Failure modes | provider fallback (`provider.ts`), worker `error` messages, `App` status/error banner |
| §11 Deployment / offline | `vite.config.ts` (COOP/COEP), `public/sw.js`, `public/_headers` |

## Limitations & future work (spec §12)

Speaker diarization, custom-vocabulary ASR biasing/fine-tuning, multilingual
support, partial-hypothesis streaming with debounced lookups, and a
domain-specific WER + precision@k evaluation harness are out of scope for v1.

## License

MIT — see [LICENSE](LICENSE).
