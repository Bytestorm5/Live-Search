# Speech Recognition

Speech recognition can run in the browser via Transformers.js, or be delegated to
the OpenAI Realtime API. The primary local model is Moonshine, purpose-built for
live use because its compute scales with the actual duration of speech.

WebGPU is used when available for in-browser inference, with a WASM fallback.
Every backend produces committed utterances that trigger documentation retrieval.
