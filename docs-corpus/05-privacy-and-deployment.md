# Privacy and Deployment

The core privacy property is structural: there is no inference server, so there
is nowhere for audio to be sent. Audio is captured into in-memory buffers and
discarded after transcription. Transcripts remain in memory; local persistence is
opt-in. Documentation queries are evaluated entirely in-browser against a locally
held index.

The privacy claim is verifiable rather than merely asserted. A strict
Content-Security-Policy with `connect-src` limited to `'self'` (or only the model
origin) makes it impossible for the page to POST audio or text anywhere else, and
this is inspectable in developer tools. Subresource Integrity pins exactly what
code runs. After the model cache is warm the app runs fully offline and can be
used air-gapped.

Two deployment headers are required for `SharedArrayBuffer`: the host must send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` so the page is cross-origin
isolated. This is the single most common deployment gotcha. A service worker is
recommended to precache model weights and assets for reliable offline use.
Hosting is any static host; no application server is required.
