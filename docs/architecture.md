# Open Voice architecture

Open Voice is a speaking voice agent. You talk to it, you see the transcript, you hear the reply while it is
being written, and you can interrupt it mid-sentence by simply speaking again.

This document describes how the pieces fit together, what is vendored from upstream and what is ours, and the
limits you have to operate inside. For how to run it, see [`runbook.md`](./runbook.md).

## Layer map

Three layers. Each one is replaceable on its own as long as it keeps the protocol between the layers.

| Layer | Process | Package | Port | Responsibility |
| --- | --- | --- | --- | --- |
| Browser | `web` | `@open-gpt-live/web` (`apps/web`) | 3000 | Microphone capture, adaptive RMS VAD, PCM pre-roll, transcript display, ordered playback, reconnect, latency diagnostics |
| Session | `agent` | `@open-voice/agent` (`packages/agent`) | 8787 | Turn orchestration, STT/LLM/TTS calls, sentence segmentation, abort and interrupt, persona |
| Providers | `speaches` + the host's OmniRoute daemon | `@open-gpt-live/adapters` | `speaches:8000`, `host.docker.internal:20128` | Speech-to-text, chat completions, text-to-speech |

The two vendored libraries that both the browser and the agent depend on:

| Package | What it holds |
| --- | --- |
| `@open-gpt-live/protocol` | The typed WebSocket message contracts. Both sides validate against the same types. |
| `@open-gpt-live/adapters` | The `LLMProvider`, `STTProvider`, `StreamingSTTProvider` and `TTSProvider` interfaces plus their OpenAI-compatible implementations. |

## What is vendored, what is ours

| Path | Origin | Our changes |
| --- | --- | --- |
| `apps/gateway/` | upstream open-gpt-live 0.2.0 | none — read as a library, not run as a process |
| `apps/web/` | upstream open-gpt-live 0.2.0 | none |
| `packages/protocol/` | upstream open-gpt-live 0.2.0 | none |
| `packages/adapters/` | upstream open-gpt-live 0.2.0 | none |
| `packages/agent/` | **ours** | the whole composition root: config, persona, providers, server |
| `docker-compose.yml`, `env.example.template`, `docs/` | **ours** | hybrid runtime configuration and its documentation |
| `Dockerfile.agent` | **ours** | runtime image for the agent |

See [`../THIRD_PARTY.md`](../THIRD_PARTY.md) for the pinned upstream revision, the license and the exact list of
locally modified upstream files.

### Why the agent replaces the gateway process

Upstream ships `apps/gateway` as a *process*: it reads `OPENAI_*` variables, builds its own providers from its
own defaults, and listens on 8787. In this topology that process is wrong on two counts:

1. It constructs `new OpenAILLMProvider()` with no arguments, so the only thing it can talk to is
   `api.openai.com`. Our LLM is OmniRoute, the STT and TTS are Speaches, and the keys are not OpenAI keys.
2. Its persona is hardcoded. We want a voice-optimized persona and the ability to swap it without a rebuild.

`@open-voice/agent` therefore imports `createGatewayServer` from the gateway package and embeds it. All turn
orchestration, VAD protocol handling, sentence segmentation and abort logic stays the vendored code — we do
not fork or patch a line of it. We replace only the two things that are injected: the `providers` object and
the `systemPrompt`.

**Consequence for operations:** the `agent` service is the only thing that listens on 8787. Do not also run
`apps/gateway`'s `dist/server.cjs` — two processes would fight over the port, and the loser fails with
`EADDRINUSE`. `Dockerfile.gateway` still exists and still builds that process, but nothing in this compose file
uses it.

## The injection seam

```ts
// packages/agent/src/server.ts
createGatewayServer({
  providers,       // <- our LLM/STT/TTS objects, built from AgentConfig
  systemPrompt,    // <- our persona
  host, port, allowedOrigins, ttsFormat, ttsVoice, logger
});
```

`providers` is a plain object of four optional slots. `packages/agent/src/providers.ts` fills three of them by
calling the vendored OpenAI-compatible adapters with explicit constructor arguments — `baseUrl`, `model`,
`apiKey`, `voice`, `format` — never the no-argument form. That is the whole reason the agent can serve three
different backends from one code path.

Configuration arrives through a single namespace defined in `packages/agent/src/config.ts`, and it is the only
place in the running stack that reads the environment:

```text
LLM_BASE_URL   LLM_API_KEY   LLM_MODEL
STT_BASE_URL   STT_API_KEY   STT_MODEL   STT_REALTIME_ENABLED
TTS_BASE_URL   TTS_API_KEY   TTS_MODEL   TTS_VOICE   TTS_FORMAT   TTS_ENABLED
AGENT_SYSTEM_PROMPT   AGENT_SYSTEM_PROMPT_FILE
GATEWAY_HOST   GATEWAY_PORT   ALLOWED_ORIGINS   LOG_LEVEL
```

`loadAgentConfig` fails fast at startup rather than at the first turn: an invalid port, a malformed origin in
`ALLOWED_ORIGINS`, an unknown `LOG_LEVEL`, or a hosted `api.openai.com` base URL without the matching key all
abort the process with a message naming the variable. The upstream `OPENAI_*` variables are never read, and
`OPEN_GPT_LIVE_ENV_FILE` (used by the vendored `loadProjectEnvironment`) can point the process at an
alternative `.env` if you need that.

## Data path for one conversational turn

Live mode, microphone to audio out:

```text
 1. Browser   AudioWorklet resamples to 24 kHz mono PCM16, 50 ms frames
              -> vad.speech_start, then audio.chunk frames (turnMode "live")

 2. Agent     Buffers frames until the VAD hangover ends
              -> STT: POST http://speaches:8000/v1/audio/transcriptions
                 (PCM16 is wrapped in a WAV header first, model Systran/faster-whisper-small)
              <- transcript.partial if realtime STT is on (it is off here), transcript.final

 3. Agent     LLM: POST http://host.docker.internal:20128/v1/chat/completions
                 stream: true, model auto/best-chat, messages = [systemPrompt, ...history, user text]
              <- llm.delta for every token, then llm.done

 4. Agent     Splits the text at sentence boundaries and synthesizes each segment in order
              -> TTS: POST http://speaches:8000/v1/audio/speech
                 (model speaches-ai/Kokoro-82M-v1.0-ONNX, voice ef_dora, format mp3)
              <- tts.start, then one tts.chunk per segment, then tts.end

 5. Browser   Queues the chunks, plays them in order, acknowledges each with playback.ack
              -> the transcript and the streamed text are visible while the audio plays
```

Interrupting is the same path cut short. When the browser's VAD reports `vad.speech_start` while audio is
still playing, it sends `interrupt`; the agent aborts the in-flight LLM stream and TTS request, drops queued
segments and stops emitting audio for that turn. Late `llm.delta` and `tts.chunk` events from the aborted
run are discarded rather than played. That is why the reply is synthesized sentence by sentence instead of in
one request: an unsegmented request cannot be cut off until it finishes. The browser does its half of the same
job with `playback.ack`, which tells the agent that a segment actually finished sounding so the next turn does
not fight the speaker.

Push-to-talk is the same thing without steps 1's VAD: the browser records with `MediaRecorder` and sends a
final `audio.chunk` with `turnMode "ptt"`.

## The hybrid boundary, and what leaves this machine

The hybrid decision is that the LLM is not ours and the speech models are.

| Path | Where it goes | What crosses it |
| --- | --- | --- |
| Browser to agent | `ws://localhost:8787`, host loopback | Audio frames, transcripts, replies |
| Agent to Speaches | `speaches:8000`, Docker network only | Transcripts in, audio out |
| **Agent to OmniRoute** | **`host.docker.internal:20128`, host loopback** | **Your conversation text, and whatever OmniRoute forwards upstream** |
| Speaches model download | `ghcr.io` and the Hugging Face CDN | Model weights only, once |
| Container images | `docker.io`, `ghcr.io` | Image layers only |

So: microphone audio stays on this machine, because faster-whisper and Kokoro both run in the `speaches`
container and the only thing that ever sees raw audio is the agent on loopback. **Text does not stay**, because
OmniRoute is a router: it forwards each request to whichever upstream provider it selects for
`auto/best-chat`, and that provider is somewhere else. Treat every turn as leaving the machine, and treat the
Hugging Face CDN as an external dependency on first start.

The container-side URL is `http://host.docker.internal:20128/v1` while the host-side URL is
`http://127.0.0.1:20128/v1`. They differ because OmniRoute binds the loopback interface only: a container
cannot reach the host's `127.0.0.1`, so compose maps `host.docker.internal` to the host gateway
(`extra_hosts: host.docker.internal:host-gateway`). If you run the agent on the host with `pnpm dev` instead,
use the loopback URL.

## Known limitations that affect operation

- **Conversation history lives only in the WebSocket connection.** The agent keeps messages in memory per
  connection. Reconnecting starts a fresh history, and a page reload loses the conversation. This is upstream
  behavior and it is intentional for now; there is no cross-session memory.
- **Realtime STT is disabled.** Live mode therefore has no partial transcript: the transcript appears after the
  turn ends, not while you are still speaking. The reason is not configuration — the OpenAI Realtime WebSocket
  transcription protocol is OpenAI-only. `OpenAIRealtimeSTTProvider` always dials OpenAI's own hosted URL and
  Speaches does not implement that protocol. `STT_REALTIME_ENABLED` stays `false`; setting it to `true`
  without an OpenAI credential makes the agent fail fast at startup by design.
- **The gateway has no authentication.** Anyone who can reach port 8787 can hold a session and make the agent
  spend model credits. Keep the published port on `127.0.0.1`. If you must expose it, put a reverse proxy with
  authentication in front and add the exact browser origins to `ALLOWED_ORIGINS`.
- **`ALLOWED_ORIGINS` is not a security boundary by default.** Empty means "any origin is accepted", which is
  what you want for a localhost-only stack. Setting it is a browser-origin filter, not identity.
- **Adaptive VAD is not acoustic echo cancellation.** It calibrates ambient noise and adjusts thresholds; it
  cannot separate your voice from the agent's own speakers through them. Use headphones, or the microphone will
  hear the agent interrupt itself.
- **The web bundle is built at image build time.** `NEXT_PUBLIC_*` variables are inlined into JavaScript by
  Next.js, so changing one requires `docker compose up -d --build web`, not a restart. The compose file
  forwards each of them as a build arg so they can come from `.env`, but they are read when the image is built.
- **The upstream request body is fixed at `{ model, messages, stream }`.** No temperature, no `max_tokens`, no
  tools. Anything the model decides to do beyond answering is not expressible yet.
- **The smoke audio in the runbook is synthetic tone, not speech.** It proves the transcription path returns a
  response; it does not prove recognition accuracy.