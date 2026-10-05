# Feature: open-voice-latency

## Goal

Cut the interaction latency of the speaking agent. The user reports it works and is too slow to
converse with. This increment is measured first, then tuned.

## Measured baseline on this machine (2026-10-05)

The turn is a serial chain: speech end → STT → LLM first token → TTS first sentence → playback.

| Stage | Measured | Source |
| --- | ---: | --- |
| VAD hangover before a turn can close | 750 ms | `NEXT_PUBLIC_VAD_HANGOVER_MS` default |
| Batch STT, `Systran/faster-whisper-small`, CPU, 2.4 s of real Spanish speech | 9.4 s | direct call to Speaches |
| Batch STT, `Systran/faster-whisper-base`, same audio | 2.9 s | direct call |
| Batch STT, `Systran/faster-whisper-tiny`, same audio | 1.6 s | direct call |
| LLM first token, `auto/best-chat` | 1300 ms | streamed call against OmniRoute |
| LLM first token, `auto/chat` | 544 ms | streamed call against OmniRoute |
| LLM first token, `groq/openai/gpt-oss-20b` | 515 ms | streamed call against OmniRoute |
| TTS, Kokoro, one short sentence | 600 ms | direct call |
| TTS, Kokoro, one full sentence | 2966 ms | direct call |

STT dominates by 5 to 10 times. The LLM is second. The machine has no NVIDIA GPU, so CTranslate2
runs on CPU; `WHISPER__COMPUTE_TYPE` and `WHISPER__CPU_THREADS` are accepted by Speaches but did not
move `small` measurably, so model choice is the lever, not quantization.

Projected chain: today roughly 12 to 14 s; with `base`, `auto/chat` and a 400 ms hangover roughly
4.4 s.

## Decisions taken by the user

- STT model: `Systran/faster-whisper-base`. Measured identical, perfect transcript on the reference
  clip, 3.2 times faster.
- LLM model: `auto/chat`. 544 ms first token against 1300 ms.
- Both config-only gains and the code changes are in scope.

## Non-goals

- No streaming STT. The OpenAI Realtime WebSocket protocol is OpenAI-only and Speaches does not
  implement it. This remains the single largest structural cost.
- No GPU.
- No change to interruption semantics, which T5 already proved.
- No multi-model routing or per-request model selection.

## Tasks

### L1 — Configuration fast path

- `env.example.template`: `STT_MODEL=Systran/faster-whisper-base`, `LLM_MODEL=auto/chat`,
  `NEXT_PUBLIC_VAD_HANGOVER_MS=400`.
- `docker-compose.yml`: give the `speaches` service `WHISPER__COMPUTE_TYPE=int8` and
  `WHISPER__CPU_THREADS=8`; make `speaches-models` pre-download the configured models so the STT swap
  does not stall the first turn.
- Record the measured numbers and the reasoning in `docs/runbook.md`, in a new performance section,
  including how to trade back to `tiny` or to `small`.
- Apply it to the running stack and confirm it comes up healthy.

### L2 — Configurable segmentation and partial interval

The gateway hardcodes `ttsSegmentMinLength` 24 and `livePartialInitialIntervalMs` 2000. Both are
already `createGatewayServer` options, so this needs no upstream change, only that the agent stops
using the defaults:

- `packages/agent/src/config.ts`: add validated `TTS_SEGMENT_MIN_LENGTH`,
  `TTS_SEGMENT_MAX_LENGTH`, `LIVE_PARTIAL_INITIAL_INTERVAL_MS` and
  `LIVE_PARTIAL_LONG_TURN_INTERVAL_MS`, keeping the existing parsing conventions.
- `packages/agent/src/server.ts`: pass them through.
- Tests for defaults, validation and wiring.
- Defaults must not silently change behavior for existing deployments: keep upstream's values unless
  the variables are set.

### L3 — Verification of the new chain

- Re-measure STT with `base` through the running agent, not only against Speaches directly.
- Re-measure LLM first token with `auto/chat` through the agent.
- Record the latency panel values the user sees in the browser, if they can read them back.
- State plainly which parts remain unverified without a human at the microphone.

## Commit plan

| Task | Commit |
| --- | --- |
| L1 | `perf(runtime): switch to faster STT and LLM models from measured latency` |
| L2 | `perf(agent): make TTS segmentation and partial transcript interval configurable` |
| L3 | `test(agent): record the tuned latency chain` |

## Commit evidence

| Task | Commit sha | Checks |
| --- | --- | --- |
| L1 | `f336401` | `docker compose config` resolves; stack healthy; `agent.started` reports `auto/chat` + `faster-whisper-base`; four WebSocket turns measured |
| L2 | see L3 commit | `pnpm -r typecheck` 5/5, `pnpm test` 15 files / 119 tests (+7) |
| L3 | see L3 commit | `TTS_SEGMENT_MIN_LENGTH` 24 -> 10: first sound 4.2 s -> 3.1 s; probe 401 false alarm gone (`agent.llm_reachable`) |