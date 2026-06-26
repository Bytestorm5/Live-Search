# Audio Capture

The microphone is opened with `getUserMedia({ audio: { channelCount: 1 } })`.
Browser-level `echoCancellation` and `noiseSuppression` are enabled by default but
exposed as settings, because aggressive suppression can hurt ASR accuracy in some
rooms.

Audio is processed by an `AudioWorklet` running on the audio rendering thread,
not the deprecated `ScriptProcessorNode`, so capture is never blocked by
main-thread UI work. The worklet writes 16 kHz mono `Float32` frames into a
lock-free ring buffer backed by a `SharedArrayBuffer`.

Pre-allocated tensors and ring buffers avoid per-frame allocation churn, which
otherwise dominates p95 latency on small models. Audio stays in memory and is
discarded after transcription — it is never written to disk and never
transmitted.
