# Voice Activity Detection

Voice activity detection (VAD) uses the Silero VAD model (ONNX, ~2 MB) run via
ONNX Runtime Web. It is small enough to run on CPU/WASM without contending for
the GPU that the ASR model needs.

VAD is mandatory: it prevents running the expensive ASR model on silence, defines
clean utterance boundaries for low-latency commits, and bounds compute on a
continuously open microphone.

The segmenter classifies speech versus silence on short (~30 ms) windows and
emits utterance segments — a contiguous run of speech bracketed by silence. An
end-of-utterance silence threshold (default 400 ms) determines when an utterance
is committed. A minimum utterance length rejects coughs and clicks. A maximum
utterance length (default 15 s) forces an incremental cut so a long monologue
still produces output.

Tunables include speech-onset sensitivity, end-of-utterance silence, and the
minimum and maximum utterance lengths.
