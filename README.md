<p align="center">
  <img src="apps/web/app/icon.svg" alt="Open Voice" width="96" />
</p>

<h1 align="center">Open Voice</h1>

<p align="center">
  <strong>A speaking voice agent you can interrupt mid-sentence.</strong>
</p>

<p align="center">
  Speak, watch the transcript appear, hear the reply while it is still being written, and start talking
  again to cut it off.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/runbook.md">Runbook</a> ·
  <a href="THIRD_PARTY.md">Third-party notices</a>
</p>

## What this is

A voice agent for one machine, built on a vendored open session layer. Open Voice keeps the interesting part —
voice activity detection, turn orchestration, sentence-segmented speech synthesis and interruption — visible
TypeScript you can read, and puts it in front of models you control.

It is not a hosted assistant and it has no billing, no accounts and no multi-tenancy. It is the local stack,
running four containers and one daemon, that you point at a microphone.

## Hybrid topology

The LLM is remote; the speech models are local.

| Layer | Runtime | Where it runs |
| --- | --- | --- |
| LLM | OmniRoute daemon, OpenAI-compatible Chat Completions | Already running on this machine at `127.0.0.1:20128` |
| STT | faster-whisper via Speaches | `speaches` container, port 8000 |
| TTS | Kokoro via Speaches | `speaches` container, same port 8000 |

Your microphone audio never leaves this machine: both speech models run in the `speaches` container. **Your
conversation text does leave it**, because OmniRoute is a router that forwards each request to whichever
upstream provider it selects. See [the hybrid boundary](docs/architecture.md#the-hybrid-boundary-and-what-leaves-this-machine).

```text
browser ──ws──> agent ──┬── http://speaches:8000/v1/audio/transcriptions
  :3000         :8787    ├── http://speaches:8000/v1/audio/speech
                        └── http://host.docker.internal:20128/v1/chat/completions
                                     └── the OmniRoute daemon already on this machine
```

The agent is not the upstream gateway process; it embeds the upstream gateway as a library and injects its own
providers and persona. `packages/agent` is the composition root, `apps/gateway` is read-only upstream code.

## Quickstart

Requirements: Docker with Compose v2, an OmniRoute daemon listening on `127.0.0.1:20128`, and a
Chromium-family browser with a microphone.

```bash
cp env.example.template .env
# put your OmniRoute token in LLM_API_KEY in .env
docker compose up -d --build
```

The first start pulls two images and downloads about 1.5 GB of speech model weights into a named volume.
Later starts reuse it and take seconds.

Then, in order:

```bash
docker compose ps                                             # all four services
curl -s http://127.0.0.1:8787/healthz                        # the agent is alive
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # the web app answers
```

Open <http://localhost:3000>, allow the microphone, and talk.

`[docs/runbook.md](docs/runbook.md)` has the provider smoke tests, the health checks in order, and a table of
common failures with their actual symptoms.

## What you get

- **Interruptible speech.** The reply is synthesized sentence by sentence, so speaking again stops the audio
  mid-sentence instead of after it finishes.
- **Streaming replies.** Text appears token by token, ahead of the audio, so the answer starts arriving
  sooner than a single-shot request would allow.
- **Two personas in one system.** A voice-optimized persona, replaceable through one environment variable or
  one file, without a rebuild.
- **No cloud dependency for speech.** faster-whisper and Kokoro run locally; no speech API key exists anywhere
  in this configuration.
- **Readable boundary.** Audio stays on the machine, and the text that does not is documented rather than
  assumed away.

## Known limits

- Conversation history lives only for the current WebSocket connection. Reload and it is gone.
- Realtime (token-delta) STT is OpenAI-only and therefore disabled; transcripts arrive at the end of a turn,
  not while you are still speaking.
- The gateway has no authentication. Keep port 8787 on localhost.
- Adaptive VAD is not acoustic echo cancellation. Use headphones.

The full list, with the reason for each, is in
[known limitations](docs/architecture.md#known-limitations-that-affect-operation).

## Layout

```text
apps/web             vendored browser app: capture, VAD, playback, diagnostics
apps/gateway         vendored session layer, used as a library
packages/protocol    vendored typed WebSocket contracts
packages/adapters    vendored provider interfaces and OpenAI-compatible adapters
packages/agent       ours: config, persona, providers, composition root
docker-compose.yml   ours: the hybrid stack
docs/                ours: architecture and runbook
odd/                 ours: feature plans
```

## Working on it

```bash
pnpm install
pnpm check      # typecheck, test, build
pnpm dev        # agent + gateway + web on the host, not in Docker
```

## Credits

The session layer, the browser app, the protocol and the provider adapters are vendored from
[open-gpt-live](https://github.com/study8677/open-gpt-live) 0.2.0 under MIT. The pinned revision, the license
and the exact list of locally modified upstream files are in [`THIRD_PARTY.md`](THIRD_PARTY.md). Everything
else in this repository is original work.

[`LICENSE`](LICENSE)