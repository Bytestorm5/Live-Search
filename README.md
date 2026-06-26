# Live Search — Live Transcription & Documentation Lookup

Live speech transcription that surfaces relevant documentation **as you speak**.
Transcription is handled by the **OpenAI Realtime API** (reliable, no client model
downloads); documentation retrieval runs **locally in your browser** against an
index you build from your own docs.

> **Design note.** This started as a fully on-device design (local Whisper/
> Moonshine via WebGPU). That required a ~175 MB first-load model download, which
> is a poor experience and unreliable in practice. Transcription was therefore
> moved to the OpenAI Realtime API. The original on-device spec is kept in
> [`docs/architecture.md`](docs/architecture.md) for reference; this README
> documents what's actually implemented.

---

## How it works

```
mic → AudioWorklet → resample 24 kHz → PCM16 → OpenAI Realtime API (WebSocket)
                                                   │  (server-side VAD + ASR)
                                                   ▼
                              committed transcript → term extraction + vocabulary
                                                     correction → local retrieval
                                                   │  (BM25, optional semantic)
                                                   ▼
                                          results panel + live transcript
```

- **Transcription:** streamed to OpenAI; server-side VAD segments utterances and
  returns committed transcripts. No local ASR model, no WebGPU requirement.
- **Retrieval:** entirely local. Lexical **BM25** by default (zero download);
  optional local **semantic** search (MiniLM, ~25 MB, opt-in).
- **Correction:** mistranscribed domain terms are repaired against your corpus's
  known vocabulary before searching (edit-distance + phonetics).
- **No backend:** a static SPA. You supply your own OpenAI API key; the browser
  connects directly to the Realtime API.

---

## Quick start

```bash
npm install
npm run ingest        # build the search index from docs-corpus/ (samples included)
npm run dev           # start the dev server
```

Open the printed URL, open **Settings**, paste your **OpenAI API key**, then click
**Start listening** and grant microphone access. Speak — transcripts stream in and
matching docs appear. A live **mic level meter** next to the button confirms audio
is being captured.

**Audio source.** Settings → *Audio source* chooses where audio comes from:

- **Microphone** (default) — your mic via `getUserMedia`.
- **Shared audio (tab/system)** — a shared tab or screen's audio via
  `getDisplayMedia`, e.g. to transcribe a **Discord/Meet call**. When the picker
  appears, choose the tab/screen and tick **"Share audio" / "Share system
  audio"**. This path is Chromium-only (Firefox doesn't support display-audio
  capture). To capture a desktop Discord call, share your **screen** with system
  audio; for Discord-in-a-browser-tab, share that **tab**'s audio.

The API key is stored only in your browser's `localStorage` and sent directly to
OpenAI to authenticate the WebSocket. **Use a key you can rotate / restrict** (see
[Security](#security)).

---

## Feeding in your documentation

Your docs are the corpus the app searches — provide them with the ingest CLI.

Put files in `docs-corpus/` (nested folders are fine; this directory is
git-ignored so your corpus stays local). Supported formats:

| Format | Extension | Title from | Notes |
|---|---|---|---|
| Markdown | `.md`, `.markdown` | first `#` heading → filename | code spans/blocks kept (API symbols) |
| Plain text | `.txt` | filename | |
| HTML | `.html`, `.htm` | `<title>` → `<h1>` → filename | tags/scripts stripped |
| JSON | `.json` | each doc's `title` | a single doc, an array, or `{ "docs": [...] }` |

JSON gives the most control:

```json
{
  "docs": [
    { "id": "billing/refunds", "title": "Issuing refunds",
      "text": "Full plain-text body …", "url": "https://docs.example.com/billing/refunds" }
  ]
}
```

`text` is required; `id`/`title` default from the path; `url` (optional) makes the
result a link. Then:

```bash
npm run ingest                 # docs-corpus/ -> public/corpus.index.ndjson
npm run ingest -- ./my-docs    # a different source directory
npm run ingest -- --out public/corpus.index.ndjson
```

Re-run after changing docs. The generated `public/corpus.index.ndjson` is what
the app loads; it's git-ignored as a derived artifact. The app also runs with no
index (transcript-only) and shows a "no corpus loaded" status.

**Large corpora.** The index is a line-delimited (NDJSON) file: one JSON record
per line. The CLI stream-writes it and the browser stream-parses it from the
fetch body, so neither side ever builds a single giant string — tens of
thousands of documents (hundreds of MB of index) ingest and load fine. (Note:
the whole index is still held in browser memory, so extremely large corpora are
bounded by RAM, and the optional local semantic embedder is impractical at that
scale — keep semantic off for big corpora and rely on BM25.)

---

## Security

This is a static SPA with no backend, so the browser authenticates to OpenAI
directly using your key via the documented (explicitly **insecure**) WebSocket
subprotocol `openai-insecure-api-key.<KEY>`. Implications:

- The key lives in the browser. Use a **restricted/project key** you can rotate,
  and don't deploy a shared key to a public site.
- Audio **is** sent to OpenAI for transcription (that's the trade we made for
  reliability). Your **documentation and all search queries stay in the browser**
  — only audio leaves, only to OpenAI.
- The CSP limits `connect-src` to this origin + `api.openai.com`, so the page
  can't exfiltrate anywhere else (inspectable in DevTools).

For a hardened deployment, front it with a tiny token endpoint that mints
[ephemeral client secrets](https://developers.openai.com/api/docs/guides/realtime)
and connect via WebRTC, so the long-lived key never reaches the browser. That's
out of scope here but the client is structured to make it a localized change.

---

## Optional: local semantic search

Lexical BM25 is on by default and needs no download. Toggle **Semantic search**
in Settings to also run a local MiniLM embedder (~25 MB, fetched once from the
model CDN, then cached). It improves recall on paraphrased topics. If it fails to
load, retrieval degrades gracefully to lexical-only.

---

## Deployment

Any static host works — there is no application server.

```bash
npm run build      # type-checks then builds to dist/
npm run preview    # serve the production build locally
```

Send the CSP from [`public/_headers`](public/_headers) (Netlify/Cloudflare Pages
format; adapt for other hosts). Note: unlike the original on-device design, this
build does **not** require `SharedArrayBuffer` / COOP+COEP — that gotcha is gone.

---

## Testing

```bash
npm test            # unit suite (Vitest)
npm run typecheck   # tsc --noEmit (strict)
npm run test:e2e    # Playwright: full flow with a mocked OpenAI WebSocket
```

Pure logic is unit-tested: PCM16/base64 conversion, the Realtime event codec
(session config + event parsing + browser subprotocols), the transcription
client (with an injected fake WebSocket), BM25 / vectors / RRF, chunking,
snippets, the retrieval engine, edit-distance/phonetics, vocabulary correction,
the rolling transcript, and DOM rendering. The e2e test drives a real browser
with a mocked WebSocket: Start → transcript → local result.

It needs a Chromium browser: set `PLAYWRIGHT_CHROMIUM_PATH` or run
`npx playwright install chromium`.

---

## Project structure

```
src/
  audio/        AudioWorklet capture (mic or shared audio) + resampler + level meter
  asr/          OpenAI Realtime client, PCM16 + protocol codec
  retrieval/    tokenizer, BM25, vectors, fusion, chunking, snippets, ingest,
                streamable NDJSON index (load/save), hybrid engine, MiniLM embedder
  terms/        phonetics, edit distance, extraction, vocabulary correction
  pipeline/     orchestrator (capture → transcribe → retrieve), rolling transcript
  ui/           DOM helpers, result rendering, app controller, styles
  ingest/       pure doc loaders (markdown/html/json → text)
  config.ts     tunables; modelEnv.ts  optional-semantic env
scripts/        ingest CLI
docs-corpus/    sample documentation (replace with your own)
public/         capture worklet, _headers, corpus index
e2e/            Playwright spec + static server
tests/          mirrors src/
```

## Configuration

[`src/config.ts`](src/config.ts) holds tunables: transcription model
(`gpt-4o-mini-transcribe` default, `gpt-4o-transcribe`, `whisper-1`), language,
noise reduction, server VAD, correction thresholds, retrieval `topK`/fusion/
chunking, and the semantic on/off flag. The UI exposes the key, model, language,
noise reduction, semantic toggle, and result count (spec §5.6).

## License

MIT — see [LICENSE](LICENSE).
