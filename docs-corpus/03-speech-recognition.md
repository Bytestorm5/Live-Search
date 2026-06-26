# Speech Recognition

Speech recognition runs entirely in the browser with Transformers.js and ONNX
Runtime Web. On startup the app probes `navigator.gpu`; if WebGPU is available it
loads the WebGPU build, otherwise it falls back to WASM and warns that latency
will be substantially higher.

The primary model is Moonshine (base or small). Moonshine is purpose-built for
live use: its compute scales with the actual duration of speech rather than
padding every clip to a fixed window, which keeps per-utterance latency low.

The alternative model is `whisper-base.en`. Whisper pads inputs to a 30-second
window, so it is less efficient for short utterances; on a continuously open
microphone this is managed with VAD-bounded segments rather than naïve
fixed-window streaming.

Every backend implements the same interface:
`transcribe(Float32Array @16kHz)` returns text, token-level confidence, and an
`isPartial` flag. Only committed utterances trigger documentation retrieval.
