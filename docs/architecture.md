# Live Transcription & Documentation Lookup — Architecture Specification

**Status:** Draft v1
**Scope:** Client-side, privacy-first live speech transcription that drives real-time documentation retrieval.
**Audience:** Engineers implementing or reviewing the system.

---

## 1. Overview

This application listens to an open microphone, transcribes speech locally and in near real time, and uses the resulting text to surface relevant entries from a known documentation corpus as people speak. The defining constraint is that **no audio or transcript ever leaves the user's device** — all speech recognition and retrieval run client-side in the browser. A secondary hard constraint is **response latency**: relevant documentation should appear within roughly one to two seconds of a topic being mentioned.

The system is delivered as a static web application. After an initial one-time model download, it runs fully offline. There is no inference backend, and in the strict configuration there is no backend at all.

### 1.1 Goals

- Transcribe continuous speech with accuracy sufficient to reliably trigger correct documentation lookups, including on domain-specific vocabulary.
- Surface relevant documentation within ~1–2 s of the triggering speech.
- Guarantee, in a verifiable way, that audio and transcripts never reach a third party.
- Run on commodity hardware in a standard browser with no installation.
- Operate offline after first load.

### 1.2 Non-goals (v1)

- Cloud or server-side transcription of any kind.
- Speaker diarization ("who said what").
- Multilingual transcription (v1 targets English).
- Multi-user synchronization or collaboration.
- Verbatim transcript archival as a primary feature (transcript is a means to retrieval, not the product).

---

## 2. Design Constraints

| Constraint | Target |
|---|---|
| End-to-end latency (end of phrase → docs visible) | ≤ 1.5 s typical, ≤ 2.5 s worst case |
| Audio egress | None. Audio is processed in memory and discarded. |
| Network dependency at runtime | None after model cache is warm. |
| ASR accuracy on domain terms | High enough that retrieval triggers correctly after vocabulary-constrained correction (see §5.4) |
| Browser support | Chromium 113+ and recent Safari with WebGPU; graceful (slow) WASM fallback elsewhere |
| Install footprint | Zero install; first-load model download ≈ 175 MB, cached thereafter |

---

## 3. High-Level Architecture

The application is a single-page app composed of a thin UI thread and a set of Web Workers that own the heavy, latency-sensitive work. Audio flows through a fixed pipeline:

```
                    ┌────────────────────────────────────────────────────────────┐
                    │                        Browser tab                          │
                    │                                                             │
  microphone ──►  AudioWorklet ──► ring buffer ──► VAD worker ──► ASR worker      │
                    │  (capture)      (16 kHz)      (segment)     (transcribe)     │
                    │                                                  │          │
                    │                                                  ▼          │
                    │                                          Term extraction    │
                    │                                          + vocab correction │
                    │                                                  │          │
                    │                                                  ▼          │
                    │                                         Retrieval worker     │
                    │                                       (lexical + semantic)   │
                    │                                                  │          │
                    │                                                  ▼          │
                    │                                              UI thread       │
                    │                                          (results panel)     │
                    └────────────────────────────────────────────────────────────┘

  Network is touched ONLY at first load, to fetch static assets + model weights.
```

The pipeline is deliberately one-directional and stateless between utterances except for a short rolling transcript window. This keeps reasoning about latency and privacy simple.

---

## 4. Data Flow

1. **Capture.** The microphone feeds an `AudioWorkletNode` running on the audio rendering thread. It downsamples to 16 kHz mono (the format the ASR and VAD models expect) and writes frames into a `SharedArrayBuffer` ring buffer.
2. **Voice activity detection.** A VAD worker reads frames from the ring buffer and classifies speech vs. silence on short (~30 ms) windows. It emits *utterance segments* — a contiguous run of speech bracketed by silence — and forwards each completed segment's audio to the ASR worker. A silence threshold (default 400 ms) determines end-of-utterance; a maximum-utterance length (default 15 s) forces a cut so a long monologue still produces incremental output.
3. **Transcription.** The ASR worker runs the speech model on each segment and produces text plus token-level confidence. Optionally it emits interim (partial) hypotheses for display, but only *committed* utterances trigger retrieval (see §6.3).
4. **Term extraction and correction.** The committed text is tokenized; candidate query terms (noun phrases, capitalized tokens, and known entity patterns) are extracted and fuzzy-matched against the documentation's known vocabulary to repair mistranscribed domain terms (§5.4).
5. **Retrieval.** The corrected terms plus a rolling transcript window are issued as a query against a hybrid index. Results are de-duplicated against what is already on screen, ranked, and the top *k* are returned with matched snippets and scores.
6. **Presentation.** The UI thread renders/updates the results panel. The live transcript is shown for context and operator trust but is not persisted unless the user explicitly opts in.

---

## 5. Component Specifications

### 5.1 Audio Capture

- **Input:** `getUserMedia({ audio: { channelCount: 1, echoCancellation, noiseSuppression } })`.
- **Processing node:** `AudioWorklet`, not the deprecated `ScriptProcessorNode`, so capture runs off the main thread and is not blocked by UI work.
- **Output:** 16 kHz mono `Float32` frames into a lock-free ring buffer in a `SharedArrayBuffer`.
- **Notes:** Browser-level noise suppression and echo cancellation are enabled by default but exposed as settings, since aggressive suppression can hurt ASR in some rooms.

### 5.2 Voice Activity Detection

- **Model:** Silero VAD (ONNX, ~2 MB), run via ONNX Runtime Web. It is small enough to run on CPU/WASM without contending for the GPU.
- **Why VAD is mandatory:** it prevents running the (expensive) ASR model on silence, defines clean utterance boundaries for low-latency commits, and bounds compute on a continuously open mic.
- **Tunables:** speech-onset sensitivity, end-of-utterance silence (default 400 ms), minimum utterance length (to reject coughs/clicks), maximum utterance length (default 15 s).

### 5.3 Speech Recognition (ASR)

Two model families are supported behind a common interface; the choice is a deployment decision, not an architectural one.

- **Primary: Moonshine (base/small) via Transformers.js + ONNX Runtime Web with the WebGPU backend.** Moonshine is purpose-built for live use: its compute scales with the actual duration of speech rather than padding every clip to a fixed window, which is the property that makes per-utterance latency low. It runs 100% locally in the browser with a WASM fallback. Reference (native) per-utterance latencies are on the order of tens to low-hundreds of milliseconds; in-browser over WebGPU, expect higher but still sub-second figures for short utterances.
- **Alternative: `whisper-base.en` via the same stack.** Useful where Whisper's broader ecosystem or specific accuracy characteristics are preferred. Whisper pads inputs to a 30-second window, so it is less efficient for short utterances; on a continuously open mic this must be managed with VAD-bounded segments rather than naïve fixed-window streaming.

**Execution provider selection.** On startup the app probes `navigator.gpu`. If WebGPU is available it loads the WebGPU build; otherwise it falls back to WASM and warns the operator that latency will be substantially higher (CPU/WASM transcription can run several times slower than real time on small models).

**Interface contract.** `transcribe(Float32Array @16kHz) → { text, tokens: [{ text, confidence }], isPartial }`. The rest of the pipeline depends only on this contract.

### 5.4 Term Extraction & Vocabulary-Constrained Correction

This stage is what makes the system robust despite small on-device models making mistakes on jargon.

- The documentation corpus has a **known vocabulary** — product names, API symbols, acronyms, and other domain terms — extracted at index-build time.
- For each committed utterance, candidate terms are fuzzy-matched (edit distance / phonetic similarity) against that vocabulary. A mistranscribed term close to a known doc term is corrected to it before querying.
- This deliberately constrains corrections to terms that *exist in the corpus*, so the retrieval trigger tolerates ASR errors without inventing spurious matches. Verbatim transcript shown to the operator remains uncorrected; only the query path is corrected.

### 5.5 Retrieval Engine

A hybrid index gives both precision on exact terms and recall on paraphrased topics.

- **Lexical (BM25 / inverted index).** Fast, interpretable, excellent for exact entity/term hits (e.g., a specific API name). Built in-browser at load or shipped pre-built.
- **Semantic (vector).** Documentation is chunked and embedded with a small local embedding model (e.g., a MiniLM-class sentence encoder, ~25 MB, via Transformers.js). At query time the corrected terms and rolling transcript window are embedded and compared by cosine similarity. This catches topic matches when the exact term wasn't spoken.
- **Fusion.** Lexical and semantic result lists are merged (e.g., reciprocal rank fusion) into a single ranking.
- **Corpus loading.** The doc set is loaded locally — bundled with the app or read from a local/static source. No query ever leaves the device.

### 5.6 Presentation Layer

- A results panel showing the top *k* documents with title, matched snippet, and a relevance score, updating as new utterances commit.
- A live transcript view for context and operator trust.
- Status indicators for: microphone state, execution provider in use (WebGPU vs. WASM), model-load progress, and offline/cache state.
- Controls for VAD sensitivity, model selection, and result count.

---

## 6. Latency Budget

Latency is dominated by two stages: waiting for end-of-utterance, and ASR inference. Everything downstream is comparatively free.

| Stage | Typical | Notes |
|---|---|---|
| Capture + framing | ~0 ms | Continuous; no added wait |
| End-of-utterance detection | ~400 ms | The silence threshold; tunable, this is a deliberate trade |
| ASR inference (WebGPU, short utterance) | 200–800 ms | Scales with utterance length and model size |
| Term extraction + vocab correction | < 20 ms | String ops over a small candidate set |
| Retrieval (lexical + semantic) | 10–60 ms | Vector query over a few thousand chunks |
| Render | < 16 ms | One frame |
| **Total (end of phrase → docs visible)** | **~0.7–1.3 s** | Within the ≤ 1.5 s target |

The silence threshold is the main lever: lowering it reduces latency but increases premature cuts mid-sentence. For a documentation copilot, committing on a stable utterance (rather than chasing word-by-word partials) avoids thrashing the results panel and is the recommended default.

---

## 7. Privacy & Security Model

The core privacy property is structural, not a policy promise: **there is no inference server, so there is nowhere for audio to be sent.**

- **Audio** is captured into in-memory buffers and discarded after transcription. It is never written to disk and never transmitted.
- **Transcripts** remain in memory. Local persistence is opt-in and stays on-device.
- **Documentation queries** are evaluated entirely in-browser against a locally held index.
- **Network** is used only at first load to fetch static assets and model weights, and these may be **self-hosted** to eliminate any third-party request. After the cache is warm the app runs fully offline and can be used air-gapped.

### 7.1 Verifiability

Because everything runs in the tab, the privacy claim is *checkable* rather than merely asserted:

- A strict **Content-Security-Policy** with `connect-src` limited to `'self'` (or only the model origin) makes it impossible for the page to POST audio or text anywhere else, and this is inspectable by anyone.
- **Subresource Integrity** on the served scripts pins exactly what code runs.
- A skeptical user can open developer tools and confirm there is no outbound audio traffic.

### 7.2 Residual trust and mitigations

The remaining trust is in the served JavaScript itself (a malicious bundle could exfiltrate). This is mitigated by self-hosting, SRI, the CSP egress restriction above, and, for the highest-assurance settings, running the app fully offline after caching so egress is impossible regardless of code.

---

## 8. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| ASR runtime | Transformers.js + ONNX Runtime Web (WebGPU, WASM fallback) | Mature in-browser inference; same API across models |
| ASR model | Moonshine base/small (primary), `whisper-base.en` (alt) | Low per-utterance latency; tunable accuracy/size |
| VAD | Silero VAD (ONNX) | Tiny, accurate, runs on CPU without contending for GPU |
| Embeddings | MiniLM-class sentence encoder (ONNX) | Small, good enough for topical retrieval |
| Lexical search | In-browser BM25 index | Precision on exact domain terms |
| Threading | AudioWorklet + Web Workers + SharedArrayBuffer | Keeps the UI thread free; deterministic latency |
| Delivery | Static SPA | No backend; trivially auditable and offline-capable |

### 8.1 Approximate model footprint (first load)

| Asset | Size (approx.) |
|---|---|
| ASR model (Moonshine base, WebGPU) | ~150 MB |
| Embedding model | ~25 MB |
| VAD model | ~2 MB |
| **Total** | **~175 MB**, cached via the Cache API / IndexedDB after first load |

---

## 9. Performance & Threading

- **AudioWorklet** owns capture so audio is never dropped by main-thread jank.
- **ASR runs in its own worker** because it is the heaviest stage; the GPU is a shared resource, so only one ASR inference is in flight at a time, with utterances queued.
- **VAD and embedding/retrieval** run in workers separate from ASR so a slow transcription does not stall segmentation or search.
- **Backpressure:** if utterances arrive faster than the ASR can process (low-end CPU, WASM fallback), the queue applies a bounded policy — drop the oldest interim segments and prioritize the most recent committed speech, since stale lookups are worthless.
- **Buffer reuse:** pre-allocated tensors and ring buffers avoid per-frame allocation churn, which otherwise dominates p95 latency on small models.

---

## 10. Failure Modes & Degradation

| Condition | Behavior |
|---|---|
| WebGPU unavailable | Fall back to WASM; warn that latency is degraded; optionally drop to a smaller model |
| Microphone permission denied | Clear, actionable error; app otherwise idle |
| First run while offline | Cannot start (weights not cached); show instructions to load once while online, or ship bundled weights for air-gapped use |
| Long monologue (no silence) | Max-utterance timer forces an incremental cut so output keeps flowing |
| Noisy room / overlapping speakers | Degraded WER; expose VAD aggressiveness and suppression settings; out-of-scope speakers tolerated since only words matter, not attribution |
| Low-end CPU, queue backs up | Backpressure drops stale segments; UI flags that it is falling behind |
| Term mistranscribed | Vocabulary-constrained correction repairs it for the query path when it is close to a known doc term |

---

## 11. Browser Support & Deployment Notes

- **WebGPU** ships by default in Chromium 113+ and in recent Safari; Firefox generally requires a flag. The app must detect support at runtime, not assume it.
- **SharedArrayBuffer** requires the page to be **cross-origin isolated**, which means the host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. This is the single most common deployment gotcha.
- **Service worker** is recommended to precache model weights and assets for reliable offline use.
- **Hosting** is any static host; no application server is required. An optional static file server may serve the documentation corpus.

---

## 12. Open Questions & Future Work

- **Speaker diarization** to attribute lines to speakers, if a future use case needs it.
- **Custom-vocabulary biasing or fine-tuning** of the ASR model for heavy domain jargon, beyond the post-hoc correction in §5.4.
- **Multilingual** support via language-specific or multilingual models.
- **Partial-hypothesis streaming** to lower *perceived* latency, with debounced lookups to avoid result-panel thrash.
- **Evaluation harness:** a domain-specific WER benchmark and a retrieval-quality (precision@k) benchmark recorded in a representative room, to make model and threshold choices data-driven rather than by feel.

---

## 13. References

- Moonshine (live-transcription ASR) and its browser build via Transformers.js / ONNX Runtime Web.
- Transformers.js and ONNX Runtime Web (WebGPU backend) for in-browser inference.
- Silero VAD for voice activity detection.
- Latency and accuracy figures cited as design assumptions are reference values from the respective projects' published benchmarks; in-browser figures will differ from native and should be confirmed against §12's evaluation harness on target hardware.
