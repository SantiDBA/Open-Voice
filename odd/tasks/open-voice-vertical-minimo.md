# Feature: open-voice-vertical-minimo

## Goal

A speaking voice agent in `Open-Voice` that talks to the user with natural turn-taking and can be interrupted mid-sentence.

Architecture, decided 2026-10-05: **hybrid**.

| Layer | Runtime | Endpoint | Why |
| --- | --- | --- | --- |
| LLM | OmniRoute (local daemon) | `http://127.0.0.1:20128/v1` | OpenAI-compatible Chat Completions, streaming, verified working. |
| STT | Speaches / faster-whisper (Docker, CPU) | `http://speaches:8000/v1` | OmniRoute audio routes have no credentials. Local is the only working voice path. |
| TTS | Speaches / Kokoro (Docker, CPU) | `http://speaches:8000/v1` | Same as STT. |

Session layer (VAD, turn orchestration, abort/interrupt, sentence-segmented TTS) comes from vendored
[open-gpt-live](https://github.com/study8677/open-gpt-live) v0.2.0 (MIT). This is a vendor, not a git
fork: own history, pinned attribution, upstream layout preserved.

## Non-goals for this increment

- No tool / function-calling loop.
- No cross-session memory (upstream keeps history per WebSocket connection only).
- No GPU inference, no realtime (token-delta) STT: the OpenAI Realtime WebSocket protocol is
  OpenAI-only and Speaches does not implement it.
- No auth in front of the Gateway. Localhost only.
- No custom frontend. Upstream `apps/web` is reused unchanged.

## Constraints and facts established during exploration

- Upstream packages are `private: true` and unpublished, so they cannot be installed by name. Vendoring
  is the supported integration path.
- `createGatewayServer({ providers, systemPrompt, ... })` is the injection seam: the agent is a
  `GatewayProviders` implementation, not a patch to turn orchestration.
- Upstream adapters accept explicit constructor config (`apiKey`, `baseUrl`, `model`), so the agent owns
  its own env namespace and injects values; upstream env names (`OPENAI_*`) are not required.
- The upstream LLM request body is `{ model, messages, stream }`. No temperature, no max_tokens, no tools.
  Out of scope here.
- Container reachability: OmniRoute binds `127.0.0.1` only, so the Gateway container needs
  `extra_hosts: host.docker.internal:host-gateway` and `LLM_BASE_URL=http://host.docker.internal:20128/v1`.
- Host baseline: Node v26.10.0, Docker 29.7.2 / Compose 5.5.1, 8 cores, 15 GiB RAM, no `pnpm` installed yet.
- OmniRoute accepted model id is `auto/best-chat` (`auto/best` is not a valid combo); it resolved to
  `openai/gpt-oss-120b` on Groq during the probe.
- OmniRoute `/v1/audio/speech` rejects every `provider/model` catalog id and `/v1/audio/transcriptions`
  404s for `nvidia/openai/whisper-large-v3`; the OpenAI-named routes report `No credentials for provider: openai`.
- The agent replaces the upstream `apps/gateway` **process**: `@open-voice/agent` is a composition root
  that embeds the vendored gateway as a library. The runtime image must build `packages/agent`, and the
  compose file must run the agent, not `dist/server.cjs` from the upstream gateway.
- Upstream adapters fall back to `process.env.TTS_VOICE` when no voice is injected, so the deployment
  MUST set `TTS_VOICE` explicitly or it will silently pick up a stray value. Upstream default `alloy` is
  an OpenAI voice that does not exist in Kokoro.
- Realtime STT cannot be redirected: `OpenAIRealtimeSTTProvider` always dials its own OpenAI-hosted
  WebSocket URL. It stays disabled in this topology.

## Tasks

### T1 — Vendor upstream and establish the workspace

- Create feature branch off `master`.
- Copy from upstream at pinned commit: `LICENSE`, `README.md`, `apps/gateway`, `apps/web`,
  `packages/protocol`, `packages/adapters`, `Dockerfile.gateway`, `Dockerfile.web`,
  `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest` config if any.
- Prune upstream-only assets: `output/`, `assets/`, `.github/`, `docs/` (only keep if useful),
  `README.zh-CN.md`, `docker-compose.yml` (replaced by hybrid), `.env.example` (replaced).
- Root `package.json`: rename to `open-voice`, keep `packageManager: pnpm@11.7.0` and
  `engines.node >= 22.13.0`, add the agent package to `dev`, `build`, `start` filters.
- `THIRD_PARTY.md`: MIT attribution, upstream URL, pinned commit sha, and an explicit list of locally
  modified upstream files.
- `.gitignore`: `.env`, `node_modules`, `.next`, `dist`, build output.
- Verify: `pnpm install` succeeds and `pnpm -r typecheck` passes on the untouched vendor.

### T2 — Build the agent package

New package `packages/agent` (`@open-voice/agent`), our code, isolated from upstream.

- `config.ts`: typed agent config from env with fail-fast validation. Own namespace:
  `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `STT_BASE_URL`, `STT_MODEL`, `TTS_BASE_URL`,
  `TTS_MODEL`, `TTS_VOICE`, `TTS_ENABLED`, `STT_REALTIME_ENABLED`, `AGENT_SYSTEM_PROMPT`,
  `AGENT_SYSTEM_PROMPT_FILE`, plus the upstream `GATEWAY_*`/`ALLOWED_ORIGINS`/`LOG_LEVEL` surface.
- `prompt.ts`: the agent persona. Voice-optimized: short replies, no markdown, no lists, one idea per
  sentence, because the output is spoken by TTS. Default prompt must not hardcode the upstream persona.
- `providers/`: construct the three providers from agent config, passing explicit constructor args.
- `server.ts`: composition root calling `createGatewayServer` with our providers and our `systemPrompt`.
  Reads `AGENT_SYSTEM_PROMPT_FILE` if set (systemd-friendly), else `AGENT_SYSTEM_PROMPT`, else default.
  Graceful SIGINT/SIGTERM shutdown, structured JSON logs.
- Tests (vitest, matching upstream conventions): config defaults and fail-fast cases, prompt loading,
  provider construction. Behavior with real providers is covered by the smoke script, not unit tests.
- Verify: `pnpm typecheck` and `pnpm test` pass.

### T3 — Hybrid runtime configuration

- `.env.example`: fully commented hybrid profile, OmniRoute for LLM, Speaches for STT and TTS,
  no secrets committed.
- `docker-compose.yml`: `gateway`, `web`, `speaches` only. No `ollama`, no `ollama-model`. Gateway gets
  `extra_hosts: host.docker.internal:host-gateway`. Healthchecks kept. Speaches model pre-download job
  kept for STT and TTS models.
- Gateway build must install the agent package (verify `Dockerfile.gateway` workspace filters cover it).
- Docs: `docs/architecture.md` (layer map, seam, data flow) and `docs/runbook.md` (start, health checks,
  troubleshooting).

### T4 — Static and provider verification

- `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Provider smoke against the real stack: OmniRoute chat streaming, local `/audio/speech`, local
  `/audio/transcriptions` round trip. Fail the task if any of the three does not return valid data.
- Confirm `TTS_VOICE` is a voice Speaches/Kokoro actually accepts (the upstream default `alloy` is an
  OpenAI voice and does not exist locally). Prefer a Spanish-capable Kokoro voice.
- Capture exact command output as evidence in this document.

### T5 — Browser acceptance

- Start the stack, open the web app, and verify with a real microphone: a spoken turn produces a
  transcript, a streamed reply, and spoken audio; and speaking again during playback interrupts it.
- Record observed latency and any VAD tuning needed. If browser automation cannot reach a microphone,
  report that honestly instead of claiming acceptance.

## Commit plan

One work-unit commit per task on the feature branch, Conventional Commits, tests and docs with behavior.

| Task | Commit |
| --- | --- |
| T1 | `chore(vendor): import open-gpt-live 0.2.0 session layer with attribution` |
| T2 | `feat(agent): add Open Voice agent composition root with configurable persona` |
| T3 | `feat(runtime): add hybrid stack with local speech and OmniRoute LLM` |
| T4 | `test(agent): verify providers against local speech and OmniRoute` |
| T5 | `docs(acceptance): record live voice and interrupt acceptance` |

## Commit evidence

| Task | Commit sha | Checks |
| --- | --- | --- |
| T1 | `e852556` | `pnpm install`, `pnpm -r typecheck` 4/4, `pnpm test` 11 files / 63 tests — pass |
| T2 | `e40b6c9` | `pnpm -r typecheck` 5/5, `pnpm test` 15 files / 105 tests, `pnpm build`, `pnpm check`; built binary fails fast without key, serves `/healthz`, exits 0 on SIGTERM |
| T3 | pending | pending |
| T4 | pending | pending |
| T5 | pending | pending |